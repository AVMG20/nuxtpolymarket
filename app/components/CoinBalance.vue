<template>
  <UTooltip :text="formatNumber(parsed, false)">
    <div class="flex items-center cursor-default gap-1.5">
      <UIcon name="i-lucide-coins" class="size-4 text-yellow-400 shrink-0" />
      <span>{{ formatNumber(parsed, compact) }}</span>
    </div>
  </UTooltip>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  value: string | number | null | undefined
  compact?: boolean
}>(), { compact: true })

const parsed = computed(() => parseFloat(String(props.value ?? '0')))
</script>