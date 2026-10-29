<script setup lang="ts">
import { XENO_MAX_STAT_LEVEL } from '#shared/utils/xeno'

// A labelled step bar (speed, yield, charges…).
withDefaults(defineProps<{
  label: string
  level: number
  max?: number
  /** Fill colour for the steps (CSS colour or var). */
  color?: string
}>(), {
  max: XENO_MAX_STAT_LEVEL,
  color: 'var(--xg-ink)'
})
</script>

<template>
  <div class="flex items-center justify-between gap-3">
    <span class="text-xs font-bold text-(--xg-muted) shrink-0 whitespace-nowrap">
      {{ label }} <b class="text-(--xg-ink) xg-num">{{ level }}</b>
    </span>
    <div class="xg-steps w-24" :style="{ '--sc': color }">
      <span v-for="n in max" :key="n" :class="n <= level ? 'on' : ''" />
    </div>
  </div>
</template>
