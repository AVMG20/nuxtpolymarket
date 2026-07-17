<script setup lang="ts">
// Every leaderboard marks the viewer's own row differently (pill badge, plain
// text, inline parenthetical) - preserved as variants rather than forcing one look.
withDefaults(defineProps<{
  show: boolean
  variant?: 'badge' | 'pill' | 'text' | 'inline'
  size?: string
}>(), {
  variant: 'pill',
  size: 'text-[10px]'
})
</script>

<template>
  <UBadge v-if="show && variant === 'badge'" color="primary" variant="subtle" size="sm">YOU</UBadge>
  <span v-else-if="show && variant === 'pill'" class="font-black text-primary bg-primary/15 px-1 py-0.5 rounded leading-none shrink-0" :class="size">YOU</span>
  <span v-else-if="show && variant === 'text'" class="font-black text-primary" :class="size">YOU</span>
  <span v-else-if="show && variant === 'inline'" class="text-muted font-normal">(you)</span>
</template>
