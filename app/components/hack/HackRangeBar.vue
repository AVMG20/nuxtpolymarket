<script setup lang="ts">
import { rollPct } from '#shared/utils/hack-config'

// Shows a rolled value's position within its full min/max range — reused
// identically for item mods (MOD_RANGES) and agent traits (AGENT_TRAIT_RANGES),
// per PLAN.md §10.5/§10.7: "how good is this roll" answered visually.
const props = defineProps<{
  min: number
  max: number
  value: number
  minLabel?: string
  maxLabel?: string
}>()

const pct = computed(() => rollPct({ min: props.min, max: props.max }, props.value))
</script>

<template>
  <div>
    <div class="hack-range-bar">
      <div
        class="hack-range-fill"
        :style="{ width: `${pct}%` }"
      />
      <div
        class="hack-range-marker"
        :style="{ left: `${pct}%` }"
      />
    </div>
    <div
      v-if="minLabel || maxLabel"
      class="hack-range-minmax"
    >
      <span>{{ minLabel }}</span>
      <span>{{ maxLabel }}</span>
    </div>
  </div>
</template>
