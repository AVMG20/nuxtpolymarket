<template>
    <div ref="host" class="vtp" />
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { buildTurret } from '~/utils/void/turrets'
import { disposeTree } from '~/utils/void/engine'
import { voidTurret, type VoidTurretId } from '#shared/utils/gamelogic/void'

const props = defineProps<{ type: string }>()

/**
 * The real in-flight turret model on a slow turntable, so the workshop shows
 * the thing you will actually bolt onto the hull rather than a drawing of it.
 */
const host = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let model: THREE.Group | null = null
let raf = 0
let time = 0

function build() {
    if (!scene) return
    if (model) {
        scene.remove(model)
        disposeTree(model)
        model = null
    }
    const def = voidTurret(props.type)
    const turret = buildTurret(props.type as VoidTurretId, def.color)
    turret.pitch.rotation.x = 0.25
    model = turret.root
    model.scale.setScalar(2.6)
    model.position.y = -0.45
    scene.add(model)
}

onMounted(() => {
    const el = host.value
    if (!el) return
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50)
    camera.position.set(0, 1.25, 3.2)
    camera.lookAt(0, 0.35, 0)
    const key = new THREE.DirectionalLight(0xfff1dd, 2.6)
    key.position.set(3, 5, 4)
    const rim = new THREE.DirectionalLight(0x6fb8ff, 2)
    rim.position.set(-4, 1, -3)
    scene.add(key, rim, new THREE.AmbientLight(0x2a4468, 1.6))

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    el.appendChild(renderer.domElement)

    const resize = () => {
        if (!renderer || !camera || !el.clientWidth) return
        renderer.setSize(el.clientWidth, el.clientHeight, false)
        camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
        camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    build()
    let last = performance.now()
    const loop = () => {
        raf = requestAnimationFrame(loop)
        const now = performance.now()
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        time += dt
        if (model) model.rotation.y += dt * 0.6
        if (renderer && scene && camera) renderer.render(scene, camera)
    }
    loop()

    onBeforeUnmount(() => {
        observer.disconnect()
        cancelAnimationFrame(raf)
        if (model) disposeTree(model)
        renderer?.dispose()
        renderer?.domElement.remove()
        renderer = null
        scene = null
    })
})

watch(() => props.type, () => build())
</script>

<style>
.vtp { width: 100%; height: 160px; background: radial-gradient(circle at 50% 40%, rgba(94, 200, 255, 0.12), rgba(4, 9, 18, 0.9) 70%); border: 1px solid var(--vr-line); }
.vtp canvas { display: block; width: 100%; height: 100%; }
</style>
