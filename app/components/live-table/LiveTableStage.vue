<script setup lang="ts">
import '~/assets/css/live-table.css'

/**
 * The table surface every game shares: felt, rail, gold arcs, and the 1720x1200
 * coordinate space furniture is positioned in.
 *
 * Games put their own absolutely-positioned elements in the default slot using
 * those coordinates directly — seats sit at (222,546) (541,604) (860,630)
 * (1179,604) (1498,546), the bet bar at y=968 and the rack at y=1052.
 */
withDefaults(defineProps<{ felt?: boolean }>(), { felt: true })

const wrap = ref<HTMLElement | null>(null)
const scale = ref(1)

// scale() needs a unitless ratio and calc() cannot divide a length by a length,
// so the fit factor has to come from measurement rather than CSS.
let observer: ResizeObserver | null = null

onMounted(() => {
    if (!wrap.value) return
    observer = new ResizeObserver(([entry]) => {
        const width = entry?.contentRect.width ?? 0
        if (width > 0) scale.value = width / 1720
    })
    observer.observe(wrap.value)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
    <div ref="wrap" class="lt-table lt-stage-wrap">
        <div class="lt-stage" :style="{ '--lt-scale': scale }">
            <template v-if="felt">
                <div class="lt-felt">
                    <div class="lt-felt-inner" />
                </div>
                <div class="lt-arc" />
                <div class="lt-arc inner" />
            </template>
            <slot />
        </div>
    </div>
</template>
