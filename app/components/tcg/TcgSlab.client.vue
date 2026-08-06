<script setup lang="ts">
import * as THREE from 'three'
import { ASPECT, resolve, resolveLegacy, makeLoader, makeMaterial, loadCard } from '~/utils/tcg/foil'
import {
    SLAB_DESIGNS, slabLayout, buildSlabEnvironment, buildShell, buildAirPanes,
    buildInnerFrame, buildWordmark, makeLabelTexture, roundedRect
} from '~/utils/tcg/slab'
import type { SlabInfo, TcgServiceKey } from '~/utils/tcg/slab'

/* A graded card in its service's slab: drag to turn it over, hover to tilt.
 * Geometry and materials come from utils/tcg/slab.ts (adapted from the
 * pokemonplaatjes slab demo); this component owns the scene, the card and
 * the interaction loop.
 */
const props = withDefaults(defineProps<{
    service: TcgServiceKey
    info: SlabInfo
    bundle: string
    assetNumber: string
    maskKind: string
    foilEffect?: string | null
    pattern?: string | null
    legacySet?: string | null
    holo?: boolean
    height?: number
}>(), {
    foilEffect: null,
    pattern: null,
    legacySet: null,
    holo: false,
    height: 560
})

const stage = ref<HTMLDivElement | null>(null)
const loading = ref(true)

const design = computed(() => SLAB_DESIGNS[props.service])
const layout = computed(() => slabLayout(design.value, ASPECT))
const stageAspect = computed(() => layout.value.slabW / layout.value.slabH)
const width = computed(() => Math.round(props.height * stageAspect.value))

let renderer: THREE.WebGLRenderer | null = null
let pending = 0
let removeVisibility: (() => void) | null = null
const disposables: Array<{ dispose(): void }> = []

onMounted(async () => {
    if (!stage.value) await nextTick()
    const el = stage.value
    if (!el) return

    const lay = layout.value
    const des = design.value

    const ren = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer = ren
    // Light clear colour at zero alpha: the page still shows through, but
    // the transmission buffer (used by the frosted holder) samples this RGB
    // where nothing was drawn — the default black turns frost grey.
    ren.setClearColor(0xf2f2f4, 0)
    ren.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    ren.setSize(width.value, props.height)
    ren.domElement.style.width = '100%'
    ren.domElement.style.height = '100%'
    ren.outputColorSpace = THREE.SRGBColorSpace
    ren.toneMapping = THREE.ACESFilmicToneMapping
    ren.toneMappingExposure = 1.0
    el.appendChild(ren.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(24, stageAspect.value, 0.1, 100)
    // Further back than the demo's 1.04: the hover lean and drag spin swing
    // the corners well outside a tight fit, and the canvas edge cuts them off.
    camera.position.z = lay.slabH / (2 * Math.tan((24 * Math.PI / 180) / 2)) * 1.28

    const envTex = buildSlabEnvironment(ren, 1)
    scene.environment = envTex
    disposables.push(envTex)

    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(-4, 5, 4)
    const fill = new THREE.DirectionalLight(0xc4d4ff, 0.55)
    fill.position.set(5, -1, 3)
    const backLight = new THREE.DirectionalLight(0xffffff, 1.6)
    backLight.position.set(-2, 3, -6)
    scene.add(key, fill, backLight, new THREE.AmbientLight(0xffffff, 0.04))

    const slab = new THREE.Group()
    scene.add(slab)

    buildShell(slab, lay)
    buildAirPanes(slab, lay)
    if (des.innerFrame) buildInnerFrame(slab, lay, des.innerFrame)
    let mark: THREE.Group | null = null
    let markBack: THREE.Group | null = null
    if (des.wordmark) ({ mark, markBack } = buildWordmark(slab, lay))

    // The card face, driven by the foil shader like everywhere else.
    const family = props.bundle.split('_en_')[0] ?? props.bundle
    const r = props.legacySet
        ? resolveLegacy({ set: props.legacySet, num: props.assetNumber, holo: props.holo })
        : resolve({
            card: family,
            num: props.assetNumber,
            mask: props.maskKind,
            effect: ((props.pattern || props.foilEffect) ?? '').toLowerCase(),
            alt: props.bundle.endsWith('_alt')
        })
    const cardMat = makeMaterial(r.uniforms)
    cardMat.toneMapped = false
    const cardMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(lay.cardW, lay.cardH, 1, 1), cardMat)
    cardMesh.position.set(0, lay.cardY, lay.cardZ)
    slab.add(cardMesh)

    const apiBase = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
        ?? 'http://127.0.0.1:8080'
    const load = makeLoader(ren)

    // The card back, cropped square → card proportions, on a rounded plane
    // matching the front's silhouette.
    const CARD_R = 0.055 * lay.cardW
    const backGeo = new THREE.ShapeGeometry(roundedRect(lay.cardW, lay.cardH, CARD_R), 48)
    {
        const pos = backGeo.attributes.position as THREE.BufferAttribute
        const uv = backGeo.attributes.uv as THREE.BufferAttribute
        for (let i = 0; i < pos.count; i++) {
            uv.setXY(i, pos.getX(i) / lay.cardW + 0.5, pos.getY(i) / lay.cardH + 0.5)
        }
        uv.needsUpdate = true
    }
    load(`${apiBase}/images/shared/CardBack.png`).then((tex: THREE.Texture) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
        tex.repeat.set(ASPECT, 1)
        tex.offset.set((1 - ASPECT) / 2, 0)
        const back = new THREE.Mesh(backGeo, new THREE.MeshStandardMaterial({
            map: tex, roughness: 0.72, metalness: 0.0
        }))
        back.position.set(0, lay.cardY, lay.cardZ - 0.004)
        back.rotation.y = Math.PI
        slab.add(back)
        invalidate()
    }).catch(() => {})

    // The label, front and back.
    // Unlit, like the card face: a lit paper material picks up the room's
    // shading and the shell's faint dark overlays, which turned the white
    // cardboard grey. The label is printed matter — show it at its own colour.
    const aniso = ren.capabilities.getMaxAnisotropy()
    const labelMat = new THREE.MeshBasicMaterial({
        map: makeLabelTexture(des, props.info, false, aniso)
    })
    labelMat.toneMapped = false
    const label = new THREE.Mesh(
        new THREE.PlaneGeometry(lay.cardW, lay.labelH, 1, 1), labelMat)
    label.position.set(0, lay.labelY, lay.cardZ)
    slab.add(label)

    const labelBackMat = new THREE.MeshBasicMaterial({
        map: makeLabelTexture(des, props.info, true, aniso)
    })
    labelBackMat.toneMapped = false
    const labelBack = new THREE.Mesh(
        new THREE.PlaneGeometry(lay.cardW, lay.labelH, 1, 1), labelBackMat)
    labelBack.position.set(0, lay.labelY, lay.cardZ - 0.004)
    labelBack.rotation.y = Math.PI
    slab.add(labelBack)

    /* ---- turning it (ported from the demo) ---- */
    const TILT = 0.30, EASE = 0.028, SETTLED = 1e-4
    const want = new THREE.Vector2(0.5, 0.5)
    const cardLocal = new THREE.Vector2(0.5, 0.5)
    let hovering = false
    let dragging = false, lastX = 0, lastY = 0
    const spin = { x: 0, y: 0 }, vel = { x: 0, y: 0 }
    const clock = new THREE.Clock()

    el.addEventListener('pointerdown', (e: PointerEvent) => {
        dragging = true
        hovering = true
        lastX = e.clientX
        lastY = e.clientY
        try { el.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
        invalidate()
    })
    const onUp = (e: PointerEvent) => {
        dragging = false
        try {
            if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
        } catch { /* synthetic pointer */ }
    }
    window.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', (e: PointerEvent) => {
        const b = el.getBoundingClientRect()
        want.set((e.clientX - b.left) / b.width, 1 - (e.clientY - b.top) / b.height)
        if (dragging) {
            vel.y = (e.clientX - lastX) / b.width * Math.PI * 2 * 0.9
            vel.x = (e.clientY - lastY) / b.height * Math.PI * 2 * 0.9
            lastX = e.clientX
            lastY = e.clientY
            spin.y += vel.y
            spin.x += vel.x
        } else {
            hovering = want.x >= 0 && want.x <= 1 && want.y >= 0 && want.y <= 1
        }
        invalidate()
    })
    el.addEventListener('pointerleave', () => {
        if (!dragging) hovering = false
        invalidate()
    })
    el.addEventListener('dblclick', () => {
        spin.x = 0
        spin.y = 0
        invalidate()
    })

    function frame() {
        const dt = Math.min(clock.getDelta(), 0.1)
        if (!dragging) {
            spin.x += vel.x
            spin.y += vel.y
            vel.x *= 0.90
            vel.y *= 0.90
            if (Math.abs(vel.x) < 1e-4) vel.x = 0
            if (Math.abs(vel.y) < 1e-4) vel.y = 0
        }
        const leanX = hovering && !dragging ? (0.5 - want.y) * TILT : 0
        const leanY = hovering && !dragging ? (want.x - 0.5) * TILT : 0
        const rate = dragging ? 0.35 : EASE * 4.0
        slab.rotation.x += (spin.x + leanX - slab.rotation.x) * rate
        slab.rotation.y += (spin.y + leanY - slab.rotation.y) * rate

        if (mark && markBack) {
            const facing = Math.cos(slab.rotation.y) * Math.cos(slab.rotation.x)
            mark.visible = facing >= 0
            markBack.visible = facing < 0
        }

        const u = r.uniforms
        u.uPointer.value.set(0.5 + Math.sin(slab.rotation.y) / TILT * 0.5,
            0.5 - Math.sin(slab.rotation.x) / TILT * 0.5)
        const slabX = (want.x - 0.5) * lay.slabW
        const slabY = (want.y - 0.5) * lay.slabH
        cardLocal.set((slabX + lay.cardW / 2) / lay.cardW,
            (slabY - (lay.cardY - lay.cardH / 2)) / lay.cardH)
        u.uLocal.value.lerp(cardLocal, EASE)
        if (hovering) u.uTime.value += dt

        ren.render(scene, camera)
        const moving = hovering || dragging
            || vel.x !== 0 || vel.y !== 0
            || Math.abs(slab.rotation.x - spin.x) > SETTLED
            || Math.abs(slab.rotation.y - spin.y) > SETTLED
        pending = moving && !document.hidden ? requestAnimationFrame(frame) : 0
    }
    function invalidate() {
        if (pending || document.hidden) return
        clock.getDelta()
        pending = requestAnimationFrame(frame)
    }

    const onVisibility = () => invalidate()
    document.addEventListener('visibilitychange', onVisibility)
    removeVisibility = () => {
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('pointerup', onUp)
    }

    try { await loadCard(load, r, apiBase) } catch { /* card face missing */ }
    loading.value = false
    invalidate()
})

onBeforeUnmount(() => {
    if (pending) {
        cancelAnimationFrame(pending)
        pending = 0
    }
    removeVisibility?.()
    for (const d of disposables) d.dispose()
    if (renderer) {
        renderer.domElement.remove()
        renderer.dispose()
        renderer = null
    }
})
</script>

<template>
    <div
        class="relative cursor-grab select-none active:cursor-grabbing"
        :style="{ width: width + 'px', height: props.height + 'px' }"
    >
        <div ref="stage" class="absolute inset-0" />
        <USkeleton v-if="loading" class="absolute inset-0 rounded-xl" />
    </div>
</template>
