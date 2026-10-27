<script setup lang="ts">
import { effectiveGrowTime, getPlant } from '#shared/utils/xeno'
import { formatDuration } from '~/lib/xeno-format'

const props = defineProps<{
  id?: string
  name: string
  tier: number
  color?: string
  speed: number
  yield: number
  baseTime: number
  value: number
  description?: string
  quantity?: number
  isHybrid?: boolean
  resources?: { id: string, name: string, emoji: string, tier: number, speed: number, yield: number }[]
}>()

const growTime = computed(() => formatDuration(props.isHybrid ? props.baseTime : effectiveGrowTime({ baseTime: props.baseTime, speed: props.speed })))
const avgValue = computed(() => props.value * (1 + props.yield / 2))
const isVoid = computed(() => !!(props.id && getPlant(props.id)?.voidPlant))
</script>

<template>
  <!-- Teleported by UTooltip, so it carries the .xeno scope itself. -->
  <div class="xeno w-64 p-3.5 space-y-3 bg-(--xg-surface) border border-(--xg-edge2) rounded-2xl shadow-(--xg-shadow-lg) text-(--xg-ink)">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="font-extrabold text-sm truncate">{{ name }}</p>
        <p v-if="quantity !== undefined" class="text-xs text-(--xg-muted) mt-0.5"><b class="xg-num text-(--xg-ink)">{{ formatNumber(quantity, false) }}</b> on the shelf</p>
      </div>
      <span v-if="isHybrid" class="xg-chip sky shrink-0">Hybrid</span>
      <XenoTierLabel v-else :tier="tier" :is-void="isVoid" class="shrink-0" />
    </div>

    <template v-if="isHybrid">
      <div v-if="resources?.length" class="space-y-1.5">
        <p class="xg-label">Each harvest gives</p>
        <div v-for="r in resources" :key="r.id" class="flex items-center gap-2 text-xs">
          <XenoPlantIcon :id="r.id" :size="20" />
          <span class="font-bold flex-1 truncate">{{ r.name }}</span>
          <span class="xg-stats">S<b>{{ r.speed }}</b> Y<b>{{ r.yield }}</b></span>
          <span class="xg-num text-(--xg-muted)">×1–{{ 1 + r.yield }}</span>
        </div>
      </div>
      <div class="xg-rule" />
      <div class="space-y-1 text-xs">
        <div class="flex justify-between"><span class="text-(--xg-muted)">Grows in</span><b class="xg-num">{{ growTime }}</b></div>
        <div class="flex justify-between"><span class="text-(--xg-muted)">Sell value</span><span class="text-(--xg-muted)">none</span></div>
        <div class="flex justify-between"><span class="text-(--xg-muted)">After harvest</span><b>regrows itself</b></div>
      </div>
    </template>

    <template v-else>
      <div class="space-y-1.5">
        <XenoStatLevel label="Speed" :level="speed" color="var(--xg-t3)" />
        <XenoStatLevel label="Yield" :level="yield" color="var(--xg-t2)" />
      </div>
      <div class="xg-rule" />
      <div class="space-y-1 text-xs">
        <div class="flex justify-between"><span class="text-(--xg-muted)">Grows in</span><b class="xg-num">{{ growTime }}</b></div>
        <div class="flex justify-between"><span class="text-(--xg-muted)">Harvest</span><b class="xg-num">1–{{ 1 + yield }}</b></div>
        <div class="flex justify-between"><span class="text-(--xg-muted)">Value</span><b class="xg-num">{{ formatNumber(value) }}</b></div>
        <div class="flex justify-between"><span class="text-(--xg-muted)">Avg per harvest</span><b class="xg-num">{{ formatNumber(avgValue) }}</b></div>
      </div>
    </template>

    <p v-if="description" class="text-xs text-(--xg-muted)">{{ description }}</p>
  </div>
</template>
