<template>
  <UTooltip :text="formatNumber(parsed, false)">
    <div
      class="flex cursor-default items-center gap-1.5"
      :class="parsed < 0 ? 'text-error' : 'text-success'"
    >
      <UIcon
        v-if="showIcon"
        class="size-4 shrink-0"
        name="i-lucide-landmark"
      />
      <span>{{ formatNumber(parsed, compact) }}</span>
    </div>
  </UTooltip>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  value: string | number | null | undefined
  compact?: boolean
  showIcon?: boolean
}>(), { compact: true, showIcon: true })

const parsed = computed(() => parseFloat(String(props.value ?? '0')))
</script>
