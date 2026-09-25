<script setup lang="ts">
import type { NcDrawing } from '#shared/utils/neighcasso/types'
import { DEFAULT_HORSE, drawHorse, gaitRate, prepareHorse, type NcPose, type PreparedHorse } from '~/utils/neighcasso/render'

/** A small animated horse: stable grid, gate cards and the editor preview. */
const props = withDefaults(defineProps<{
    drawing: NcDrawing | null
    /** CSS px. */
    height?: number
    /** CSS px; defaults to 1.6x the height. */
    width?: number
    gait?: number
    pose?: NcPose
    flip?: boolean
}>(), {
    height: 96,
    width: undefined,
    gait: 0,
    pose: undefined,
    flip: false
})

const canvas = ref<HTMLCanvasElement | null>(null)
const cssWidth = computed(() => props.width ?? Math.round(props.height * 1.6))

// Path2D only exists in the browser, so preparing waits for mount.
let horse: PreparedHorse | null = null
let raf = 0
let visible = true
let observer: IntersectionObserver | null = null
let last = 0
let stride = 0
let poseStart = 0
const seed = Math.floor(Math.random() * 1000)

function prepare() {
    try {
        horse = prepareHorse(props.drawing ?? DEFAULT_HORSE)
    } catch {
        horse = prepareHorse(DEFAULT_HORSE)
    }
}

watch(() => props.drawing, prepare, { deep: true })
watch(() => props.pose, () => {
    poseStart = performance.now()
})

function frame(now: number) {
    raf = 0
    const el = canvas.value
    if (!el || !visible || !horse) return
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
    last = now
    stride += dt * gaitRate(props.gait)

    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const w = cssWidth.value
    const h = props.height
    const pw = Math.round(w * dpr)
    const ph = Math.round(h * dpr)
    if (el.width !== pw || el.height !== ph) {
        el.width = pw
        el.height = ph
    }
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, pw, ph)
    ctx.scale(dpr, dpr)

    // Leave headroom for bobbing, rearing and the nap Zzz.
    const fit = Math.min(h * 0.72, (w * 0.8) * horse.h / horse.w)
    const poseT = (now - poseStart) / 1000
    drawHorse(ctx, horse, {
        x: w / 2,
        y: h * 0.92,
        height: fit,
        time: now / 1000,
        gait: props.gait,
        stride,
        pose: props.pose,
        poseT: props.pose === 'spin' ? poseT % 1.6 : poseT % 3,
        poseDur: props.pose === 'spin' ? 1 : 2.5,
        flip: props.flip,
        seed
    })
    raf = requestAnimationFrame(frame)
}

function start() {
    if (!raf && visible) {
        last = 0
        raf = requestAnimationFrame(frame)
    }
}

onMounted(() => {
    prepare()
    observer = new IntersectionObserver((entries) => {
        visible = entries.some(e => e.isIntersecting)
        if (visible) start()
    })
    if (canvas.value) observer.observe(canvas.value)
    start()
})

onBeforeUnmount(() => {
    observer?.disconnect()
    if (raf) cancelAnimationFrame(raf)
    raf = 0
})
</script>

<template>
    <canvas
        ref="canvas"
        class="block"
        :style="{ width: `${cssWidth}px`, height: `${height}px` }"
    />
</template>
