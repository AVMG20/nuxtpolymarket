<script setup lang="ts">
const props = defineProps<{
  prefix: string
  level: number
}>()

// Color scale: gray at 0, warm spectrum 1-5, cool spectrum 6-10
const LEVEL_COLORS: Record<number, string> = {
  0:  'text-gray-400 bg-gray-400/20',
  1:  'text-green-400 bg-green-400/20',
  2:  'text-lime-400 bg-lime-400/20',
  3:  'text-yellow-400 bg-yellow-400/20',
  4:  'text-amber-400 bg-amber-400/20',
  5:  'text-orange-400 bg-orange-400/20',
  6:  'text-red-400 bg-red-400/20',
  7:  'text-pink-400 bg-pink-400/20',
  8:  'text-purple-400 bg-purple-400/20',
  9:  'text-blue-400 bg-blue-400/20',
  10: 'text-cyan-400 bg-cyan-400/20',
}

const colorClass = computed(() => LEVEL_COLORS[props.level] ?? LEVEL_COLORS[0])
</script>

<template>
  <span
    class="text-xs font-bold rounded px-1 py-0.5 leading-none tabular-nums"
    :class="colorClass"
  >{{ prefix }}{{ level }}</span>
</template>
