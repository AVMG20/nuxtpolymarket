<script setup lang="ts">
import { tierNameColor, effectiveGrowTime } from '#shared/utils/xeno'
import { formatDuration } from '~/lib/xeno-format'

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
  isHybrid?: boolean
  resources?: { id: string; name: string; emoji: string; tier: number; speed: number; yield: number }[]
}>()

const growTime = computed(() => formatDuration(effectiveGrowTime({ baseTime: props.baseTime, speed: props.speed })))
const avgValue = computed(() => props.value * (1 + props.yield / 2))
</script>

<template>
  <div class="w-60 p-3 space-y-3 bg-elevated border border-default rounded-xl shadow-xl">
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="flex items-center gap-1.5">
          <p class="font-bold text-sm" :class="tierNameColor(tier)">{{ name }}</p>
          <span
            v-if="isHybrid"
            class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 leading-none"
          >Hybrid</span>
        </div>
        <p v-if="quantity !== undefined" class="text-xs font-semibold mt-0.5">
          {{ quantity }} remaining
        </p>
      </div>
      <XenoTierLabel :tier="tier" class="bg-elevated border border-default rounded-full px-2 py-0.5 shrink-0" />
    </div>

    <!-- ── Hybrid: per-resource breakdown ── -->
    <template v-if="isHybrid">
      <USeparator />
      <div v-if="resources && resources.length" class="space-y-1.5">
        <p class="text-xs text-muted uppercase tracking-wider font-semibold">Produces per harvest</p>
        <div class="space-y-1">
          <div v-for="r in resources" :key="r.id" class="flex items-center gap-1.5 text-xs">
            <XenoPlantIcon :id="r.id" :size="16" />
            <span class="font-medium flex-1 truncate" :class="tierNameColor(r.tier)">{{ r.name }}</span>
            <XenoLevelBadge prefix="S" :level="r.speed" />
            <XenoLevelBadge prefix="Y" :level="r.yield" />
            <span class="text-muted tabular-nums">×1–{{ 1 + r.yield }}</span>
          </div>
        </div>
      </div>

      <USeparator />
      <div class="space-y-1">
        <div class="flex justify-between text-xs">
          <span class="text-muted uppercase tracking-wider font-semibold">Growth</span>
          <span class="font-mono">{{ growTime }}</span>
        </div>
        <div class="flex justify-between text-xs">
          <span class="text-muted uppercase tracking-wider font-semibold">Sell value</span>
          <span class="font-mono text-muted">— vessel</span>
        </div>
        <div class="flex justify-between text-xs">
          <span class="text-muted uppercase tracking-wider font-semibold">Regrows</span>
          <span class="font-mono text-primary">self ×harvest</span>
        </div>
      </div>
    </template>

    <!-- ── Normal plant ── -->
    <template v-else>
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
          <CoinBalance :show-icon="false" :value="value" :compact="false" />
        </div>
        <div class="flex justify-between text-xs">
          <span class="text-muted uppercase tracking-wider font-semibold">Avg value</span>
          <CoinBalance :show-icon="false" :value="avgValue" :compact="false" />
        </div>
      </div>
    </template>

    <p v-if="description" class="text-xs text-muted/70 italic">{{ description }}</p>
  </div>
</template>
