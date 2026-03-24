<template>
  <UTooltip :text="formatNumber(parsed, false)">
    <div class="flex items-center cursor-default gap-1.5">
      <UIcon name="i-lucide-gem" class="size-4 text-cyan-400 shrink-0" />
      <span>{{ formatNumber(parsed, compact, 0) }}</span>
    </div>
  </UTooltip>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  value: number | null | undefined
  compact?: boolean
}>(), { compact: true })

const parsed = computed(() => props.value ?? 0)
</script>