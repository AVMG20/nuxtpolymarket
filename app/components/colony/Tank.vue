<script setup lang="ts">
// Nutrition tank — a horizontal glass vat with sloshing liquid. Coin-fed
// nutrition is the green base layer, gem-fed sits on top as a blue layer.
const props = withDefaults(defineProps<{
  value: number
  gemValue?: number
  max: number
  starving?: boolean
  low?: boolean
}>(), { gemValue: 0, starving: false, low: false })

const pct = computed(() => props.max > 0 ? Math.min(100, (props.value / props.max) * 100) : 0)
const gemPct = computed(() => props.max > 0 ? Math.min(100 - pct.value, (props.gemValue / props.max) * 100) : 0)

const bubbles = Array.from({ length: 7 }, (_, i) => ({
  id: i,
  left: `${8 + (i * 13) % 80}%`,
  dur: `${2.4 + (i % 4) * 0.7}s`,
  delay: `${-(i * 0.9)}s`
}))
</script>

<template>
  <div class="colony-tank h-9 w-full">
    <div
      class="colony-tank-liquid"
      :class="starving ? 'colony-tank-liquid-empty' : low ? 'colony-tank-liquid-low' : ''"
      :style="{ width: `${pct}%` }"
    >
      <span
        v-for="b in bubbles"
        :key="b.id"
        class="colony-tank-bubble"
        :style="{ 'left': b.left, '--dur': b.dur, '--delay': b.delay }"
      />
      <span class="colony-tank-wave" />
    </div>
    <div
      v-if="gemPct > 0"
      class="colony-tank-liquid colony-tank-liquid-gem"
      :style="{ left: `${pct}%`, width: `${gemPct}%` }"
    >
      <span class="colony-tank-wave" />
    </div>
    <div class="colony-tank-glass" />
    <!-- tick marks -->
    <div class="absolute inset-y-0 left-1/4 w-px bg-white/10" />
    <div class="absolute inset-y-0 left-1/2 w-px bg-white/15" />
    <div class="absolute inset-y-0 left-3/4 w-px bg-white/10" />
    <div class="absolute inset-0 flex items-center justify-center text-[11px] font-black tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
      <slot />
    </div>
  </div>
</template>
