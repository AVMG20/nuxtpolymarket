<template>
  <UTooltip :text="tooltip || formatNumber(parsed, false, minimumFractionDigits)" :ui="tooltip ? { content: 'h-auto max-w-64 whitespace-normal' } : undefined">
    <div class="flex items-center cursor-default gap-1.5" :class="danger ? 'text-error' : undefined">
      <UIcon v-if="showIcon" name="i-lucide-coins" class="size-4 shrink-0" :class="danger ? 'text-error' : 'text-yellow-400'" />
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
  /** Renders the amount in the error color — the bank is garnishing earnings. */
  danger?: boolean
  /** Replaces the default exact-amount tooltip. */
  tooltip?: string
}>(), { compact: true, showIcon: true, minimumFractionDigits: 0, danger: false, tooltip: '' })

const parsed = computed(() => parseFloat(String(props.value ?? '0')))
</script>
