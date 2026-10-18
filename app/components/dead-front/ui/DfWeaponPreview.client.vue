<template>
    <div ref="wrap" class="df-preview" @pointermove="onPointer" @pointerleave="onLeave">
        <canvas ref="canvas" class="df-preview-canvas" :class="{ ready }" />
    </div>
</template>

<script setup lang="ts">
// A small lamp-lit turntable of the selected weapon, using the same model the
// match uses (buildDfWeaponModel). One renderer for the component's lifetime;
// models are swapped in place. Renders only while on screen.
import * as THREE from 'three'
import type { DfAttachmentChoice, DfWeaponId } from '#shared/utils/dead-front/types'
import { buildDfWeaponModel, disposeDfWeaponModel } from '~/utils/dead-front/weapons'

const props = withDefaults(defineProps<{
    weapon: DfWeaponId
    pap?: number
    attachments?: DfAttachmentChoice
}>(), { pap: 0, attachments: () => ({}) })

const emit = defineEmits<{ failed: [] }>()

const wrap = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const ready = ref(false)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let pivot: THREE.Group | null = null
let model: THREE.Group | null = null
let raf = 0
let visible = true
let io: IntersectionObserver | null = null
let ro: ResizeObserver | null = null
let pointerX = 0
let pointerY = 0
let tiltX = 0
let tiltY = 0
let swapT = 1
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function onPointer(e: PointerEvent) {
    const r = wrap.value?.getBoundingClientRect()
    if (!r) return
    pointerX = ((e.clientX - r.left) / r.width) * 2 - 1
    pointerY = ((e.clientY - r.top) / r.height) * 2 - 1
}

function onLeave() {
    pointerX = 0
    pointerY = 0
}

function resize() {
    if (!renderer || !camera || !wrap.value) return
    const w = Math.max(1, wrap.value.clientWidth)
    const h = Math.max(1, wrap.value.clientHeight)
    // Never below native resolution; supersample standard screens for the thin barrels.
    renderer.setPixelRatio(Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    fit()
}

/** Scale and centre the model so its length fills ~80% of the frame. */
function fit() {
    if (!model || !camera || !pivot) return
    // Measure in the model's own space (muzzle along -z), detached from the pivot.
    pivot.remove(model)
    model.position.set(0, 0, 0)
    model.scale.setScalar(1)
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    pivot.add(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const len = Math.max(size.z, 0.001)
    const dist = camera.position.length()
    const viewH = 2 * Math.tan((camera.fov * Math.PI) / 360) * dist
    const viewW = viewH * camera.aspect
    const s = Math.min((viewW * 0.8) / len, (viewH * 0.78) / Math.max(size.y, 0.001))
    model.scale.setScalar(s)
    model.position.set(-center.x * s, -center.y * s, -center.z * s)
}

function load() {
    if (!pivot) return
    if (model) disposeDfWeaponModel(model)
    model = buildDfWeaponModel(props.weapon, props.pap, props.attachments)
    pivot.add(model)
    fit()
    swapT = reduced ? 1 : 0
}

function frame(now: number) {
    raf = requestAnimationFrame(frame)
    if (!visible || !renderer || !scene || !camera || !pivot) return
    const t = now / 1000
    tiltX += (pointerY * 0.18 - tiltX) * 0.08
    tiltY += (pointerX * 0.45 - tiltY) * 0.08
    swapT = Math.min(1, swapT + 1 / 30)
    const k = 1 - (1 - swapT) ** 3
    const sway = reduced ? 0 : Math.sin(t * 0.6) * 0.2
    // Side-on profile (muzzle right) with a slow lamp-lit sway.
    pivot.rotation.set(tiltX + (reduced ? 0 : Math.sin(t * 0.9) * 0.04), -Math.PI / 2 + 0.22 + sway + tiltY + (1 - k) * 1.2, 0)
    pivot.position.y = reduced ? 0 : Math.sin(t * 1.3) * 0.012
    pivot.scale.setScalar(0.85 + 0.15 * k)
    renderer.render(scene, camera)
}

onMounted(() => {
    const el = canvas.value
    if (!el) return
    try {
        renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
        emit('failed')
        return
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(18, 2, 0.05, 30)
    camera.position.set(0, 0.08, 3.6)
    camera.lookAt(0, 0, 0)

    // Gas-lamp key from the upper left, cold moonlight rim, warm floor bounce.
    scene.add(new THREE.HemisphereLight(0xa9b4c4, 0x4a3018, 1.5))
    const key = new THREE.DirectionalLight(0xffc27a, 3)
    key.position.set(-1.5, 1.6, 2)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fb6ff, 1.4)
    rim.position.set(1.8, 0.6, -1.6)
    scene.add(rim)
    const fillL = new THREE.PointLight(0xff9a40, 1.2, 6)
    fillL.position.set(0.6, -0.8, 1.4)
    scene.add(fillL)

    pivot = new THREE.Group()
    scene.add(pivot)
    load()
    resize()
    ready.value = true

    ro = new ResizeObserver(resize)
    if (wrap.value) ro.observe(wrap.value)
    io = new IntersectionObserver((entries) => {
        visible = entries.some(e => e.isIntersecting)
    })
    if (wrap.value) io.observe(wrap.value)
    raf = requestAnimationFrame(frame)
})

watch(() => [props.weapon, props.pap, JSON.stringify(props.attachments)], load)

onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    io?.disconnect()
    ro?.disconnect()
    if (model) disposeDfWeaponModel(model)
    model = null
    renderer?.dispose()
    renderer?.forceContextLoss()
    renderer = null
    scene = null
})
</script>

<style scoped>
.df-preview {
    position: relative;
    width: 100%;
    height: 100%;
}

.df-preview-canvas {
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.6s ease;
}

.df-preview-canvas.ready {
    opacity: 1;
}
</style>
