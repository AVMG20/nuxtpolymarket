<template>
    <span class="df-count">{{ text }}</span>
</template>

<script setup lang="ts">
// A number that ticks up from zero like a field clerk tallying the night.
const props = withDefaults(defineProps<{
    value: number
    delay?: number
    duration?: number
    compact?: boolean
}>(), { delay: 0, duration: 1200, compact: false })

const shown = ref(0)
const text = computed(() => (props.compact ? formatNumber(shown.value) : Math.round(shown.value).toLocaleString('en-US')))
let raf = 0

function run() {
    cancelAnimationFrame(raf)
    const to = props.value
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        shown.value = to
        return
    }
    const from = 0
    const t0 = performance.now() + props.delay
    const step = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - t0) / props.duration))
        const k = 1 - (1 - t) ** 4
        shown.value = from + (to - from) * k
        if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
}

onMounted(run)
watch(() => props.value, run)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<style scoped>
.df-count {
    font-variant-numeric: tabular-nums;
}
</style>
