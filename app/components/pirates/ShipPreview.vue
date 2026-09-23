<script setup lang="ts">
import { drawShipPreview, enemyLook, skinLook } from '~/utils/pirates-engine/ships'

// A procedurally drawn ship on a small canvas: a player skin (skinId) or an
// enemy tier (tierId). Drawing happens client-side only, so on the server
// this renders an empty canvas that fills in on mount.

const props = withDefaults(defineProps<{
    skinId?: string
    tierId?: string
    gunCount?: number
    gunColors?: number[]
    gunTierIds?: string[]
    /** Ship heading in radians; defaults to bow up and slightly right. */
    angle?: number
    animate?: boolean
}>(), { skinId: undefined, tierId: undefined, gunCount: undefined, gunColors: undefined, gunTierIds: undefined, angle: -Math.PI / 2 + 0.35, animate: false })

const canvas = ref<HTMLCanvasElement | null>(null)
let frame = 0
let observer: ResizeObserver | null = null
const started = performance.now()

function look() {
    return props.tierId ? enemyLook(props.tierId) : skinLook(props.skinId ?? 'starter')
}

function draw() {
    const el = canvas.value
    if (!el) return
    const time = (performance.now() - started) / 1000
    drawShipPreview(el, look(), {
        angle: props.angle + (props.animate ? Math.sin(time * 0.8) * 0.06 : 0),
        time: props.animate ? time : 0,
        gunCount: props.gunCount,
        gunColors: props.gunColors,
        gunTierIds: props.gunTierIds
    })
}

function sizeCanvas() {
    const el = canvas.value
    if (!el) return
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const width = Math.max(1, Math.round(el.clientWidth * dpr))
    const height = Math.max(1, Math.round(el.clientHeight * dpr))
    if (el.width !== width || el.height !== height) {
        el.width = width
        el.height = height
    }
    draw()
}

function loop() {
    draw()
    frame = requestAnimationFrame(loop)
}

function restart() {
    cancelAnimationFrame(frame)
    frame = 0
    if (props.animate) frame = requestAnimationFrame(loop)
    else draw()
}

onMounted(() => {
    observer = new ResizeObserver(sizeCanvas)
    if (canvas.value) observer.observe(canvas.value)
    sizeCanvas()
    restart()
})

watch(() => [props.skinId, props.tierId, props.gunCount, props.gunColors, props.gunTierIds, props.angle, props.animate], restart)

onUnmounted(() => {
    cancelAnimationFrame(frame)
    observer?.disconnect()
})
</script>

<template>
  <canvas ref="canvas" class="block" :aria-label="tierId ? `${tierId} ship` : `${skinId ?? 'starter'} ship`" role="img" />
</template>
