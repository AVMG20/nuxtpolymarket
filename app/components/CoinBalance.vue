<template>
  <UTooltip :text="formatNumber(parsed, false, minimumFractionDigits)">
    <div class="flex items-center cursor-default gap-1.5">
      <UIcon v-if="showIcon" name="i-lucide-coins" class="size-4 text-yellow-400 shrink-0" />
      <span>{{ formatNumber(parsed, compact, minimumFractionDigits) }}</span>
    </div>
  </UTooltip>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  value: string | number | null | undefined
  compact?: boolean
  showIcon?: boolean
  minimumFractionDigits?: number
}>(), { compact: true, showIcon: true, minimumFractionDigits: 0 })

const parsed = computed(() => parseFloat(String(props.value ?? '0')))
</script>
