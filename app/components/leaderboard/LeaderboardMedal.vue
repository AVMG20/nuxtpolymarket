<script setup lang="ts">
// Shared rank-0..2 medal icon + color scheme, so pages don't redeclare the same arrays.
withDefaults(defineProps<{
  rank: number
  size?: string
  colors?: string[]
}>(), {
  size: 'size-5',
  colors: () => ['text-yellow-400', 'text-slate-400', 'text-amber-600']
})

const icons = ['i-lucide-medal', 'i-lucide-award', 'i-lucide-star']
</script>

<template>
  <UIcon v-if="rank < 3" :name="icons[rank]!" :class="[size, colors[rank]]" />
</template>
