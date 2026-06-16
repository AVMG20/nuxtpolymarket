<script setup lang="ts">
import { XENO_MAX_STAT_LEVEL } from '#shared/utils/xeno'

withDefaults(defineProps<{
  label: string
  level: number
  max?: number
  /** Tailwind bg-* class for filled dots, e.g. "bg-warning" */
  color?: string
}>(), {
  max: XENO_MAX_STAT_LEVEL,
  color: 'bg-primary',
})
</script>

<template>
  <div class="flex items-center justify-between gap-3">
    <span class="text-xs font-bold uppercase tracking-wider text-muted shrink-0 whitespace-nowrap">
      {{ label }} {{ level }}
    </span>
    <div class="flex items-center gap-0.5">
      <div
        v-for="n in max"
        :key="n"
        class="size-2 rounded-full transition-colors"
        :class="n <= level ? color : 'bg-black/10 dark:bg-white/15'"
      />
    </div>
  </div>
</template>
