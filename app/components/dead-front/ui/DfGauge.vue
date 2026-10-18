<template>
    <div
        class="df-gauge"
        :class="[`size-${size}`, { glow }]"
        :style="{ '--c': color, '--p': shown }"
        role="progressbar"
        :aria-valuenow="Math.round(shown * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
    >
        <div class="track">
            <div class="fill" />
            <div v-if="ticks > 1" class="ticks">
                <i v-for="i in ticks - 1" :key="i" :style="{ left: `${(i / ticks) * 100}%` }" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
// A block gauge: a black-framed track with a flat lit fill cut into blocks,
// like a row of voxels. The fill eases in from empty on mount and springs to
// new values.
const props = withDefaults(defineProps<{
    value: number
    color?: string
    ticks?: number
    size?: 'sm' | 'md' | 'lg'
    glow?: boolean
}>(), { color: '#e2b24f', ticks: 0, size: 'md', glow: false })

const shown = ref(0)
const target = computed(() => Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0)))

onMounted(() => {
    requestAnimationFrame(() => {
        shown.value = target.value
    })
})
watch(target, (v) => {
    shown.value = v
})
</script>

<style scoped>
.df-gauge {
    --h: 10px;
    --seg: 8px;
    padding: 2px;
    background: #0b0906;
    box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
}

.df-gauge.size-sm {
    --h: 6px;
    --seg: 6px;
}

.df-gauge.size-lg {
    --h: 14px;
    --seg: 10px;
}

.track {
    position: relative;
    height: var(--h);
    overflow: hidden;
    background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.07) 0 var(--seg), transparent var(--seg) calc(var(--seg) + 2px)), #1b1712;
}

.fill {
    position: absolute;
    inset: 0;
    clip-path: inset(0 calc((1 - var(--p)) * 100%) 0 0);
    background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0 2px, transparent 2px calc(100% - 2px), rgba(0, 0, 0, 0.3) calc(100% - 2px)),
        var(--c);
    -webkit-mask: repeating-linear-gradient(90deg, #000 0 var(--seg), transparent var(--seg) calc(var(--seg) + 2px));
    mask: repeating-linear-gradient(90deg, #000 0 var(--seg), transparent var(--seg) calc(var(--seg) + 2px));
    transition: clip-path 1.1s cubic-bezier(0.25, 1.1, 0.4, 1);
}

.glow .fill {
    filter: drop-shadow(0 0 4px var(--c));
}

.ticks i {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: #0b0906;
}
</style>
