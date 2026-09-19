<template>
    <div ref="host" class="vsp" />
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildShip } from '~/utils/void/ships'
import { buildTurret, turretMounts, turretMountScale } from '~/utils/void/turrets'
import { disposeTree } from '~/utils/void/engine'
import { voidShip, voidTurret, voidTurretBonus, type VoidTurretId } from '#shared/utils/gamelogic/void'

const props = defineProps<{ shipId: string, tier?: number, turrets: (string | null)[] }>()

/** Another pilot's hull with the turrets they fitted, on a slow turntable. */
const host = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let model: THREE.Group | null = null
let envMap: THREE.Texture | null = null
let raf = 0

const UP = new THREE.Vector3(0, 1, 0)

function build() {
    if (!scene || !camera) return
    if (model) {
        scene.remove(model)
        disposeTree(model)
        model = null
    }
    const built = buildShip(props.shipId, props.tier)
    const root = new THREE.Group()
    root.add(built.group)
    const scale = turretMountScale(built, voidTurretBonus(voidShip(props.shipId)))
    turretMounts(built, props.turrets.length).forEach((mount, i) => {
        const type = props.turrets[i] as VoidTurretId | null
        if (!type) return
        const turret = buildTurret(type, voidTurret(type).color)
        turret.root.position.copy(mount.position)
        turret.root.quaternion.setFromUnitVectors(UP, mount.normal)
        turret.root.scale.setScalar(scale)
        root.add(turret.root)
    })
    // Start on the bow quarter, not the engines.
    root.rotation.y = 2.2
    model = root
    scene.add(root)
    // Frame every hull the same, from a Sparrow to a Leviathan.
    const r = built.radius
    camera.position.set(0, r * 1.05, r * 2.9)
    camera.lookAt(0, 0, 0)
    camera.far = r * 12
    camera.updateProjectionMatrix()
}

onMounted(() => {
    const el = host.value
    if (!el) return
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200)
    const key = new THREE.DirectionalLight(0xfff1dd, 2.4)
    key.position.set(3, 5, 4)
    const rim = new THREE.DirectionalLight(0x6fb8ff, 2.2)
    rim.position.set(-4, 1.5, -3)
    scene.add(key, rim, new THREE.HemisphereLight(0x9fc4ff, 0x141c2a, 1.2))

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    el.appendChild(renderer.domElement)
    // Bare metal is nearly black without something to reflect, so give it a soft studio to mirror.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    envMap = pmrem.fromScene(room, 0.04).texture
    scene.environment = envMap
    scene.environmentIntensity = 0.55
    room.dispose()
    pmrem.dispose()

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
        if (model) model.rotation.y += dt * 0.45
        if (renderer && scene && camera) renderer.render(scene, camera)
    }
    loop()

    onBeforeUnmount(() => {
        observer.disconnect()
        cancelAnimationFrame(raf)
        if (model) disposeTree(model)
        envMap?.dispose()
        renderer?.dispose()
        renderer?.domElement.remove()
        renderer = null
        scene = null
    })
})

watch(() => [props.shipId, props.tier, props.turrets.join(',')], () => build())
</script>

<style>
.vsp { width: 100%; height: 260px; background: radial-gradient(circle at 50% 45%, rgba(94, 200, 255, 0.12), rgba(4, 9, 18, 0.9) 70%); border-bottom: 1px solid var(--vr-line); }
.vsp canvas { display: block; width: 100%; height: 100%; }
</style>
