<script setup lang="ts">
withDefaults(defineProps<{
  rows?: number
  height?: string
}>(), {
  rows: 8,
  height: 'h-20'
})
</script>

<template>
  <div class="space-y-3">
    <USkeleton v-for="i in rows" :key="i" class="rounded-xl" :class="height" />
  </div>
</template>
