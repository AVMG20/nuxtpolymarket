<script setup lang="ts">
/** A number that glides to its new value instead of jumping. */
const props = withDefaults(defineProps<{
  value: number
  duration?: number
  compact?: boolean
}>(), {
  duration: 650,
  compact: false
})

const shown = ref(props.value)
let raf = 0

watch(() => props.value, (to) => {
  cancelAnimationFrame(raf)
  const from = shown.value
  if (from === to) return
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / props.duration)
    const eased = 1 - (1 - t) ** 3
    shown.value = from + (to - from) * eased
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
})

onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <span class="tabular-nums">{{ formatNumber(Math.round(shown), compact) }}</span>
</template>
