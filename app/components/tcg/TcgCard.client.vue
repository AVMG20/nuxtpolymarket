<script setup lang="ts">
import * as THREE from 'three'
import type { TcgWearSpec } from '#shared/types/tcg'
import { ASPECT, resolve, resolveLegacy, makeLoader, makeMaterial, loadCard } from '~/utils/tcg/foil'
import { makeWearMaterial, makeEraserMaterial } from '~/utils/tcg/wear'

const props = withDefaults(defineProps<{
    bundle: string
    assetNumber: string
    maskKind: string
    foilEffect?: string | null
    /** Reverse-pattern variant ('pokeball' | 'masterball') — overrides the
     *  effect, since these parallels have their own foil treatment. */
    pattern?: string | null
    /** Legacy scan folder ('base1'); when set the card renders via resolveLegacy. */
    legacySet?: string | null
    holo?: boolean
    height?: number
    /** Suppress the loading skeleton — for hosts that keep their own
     *  placeholder visible underneath (e.g. the lightbox crossfade). */
    bare?: boolean
    /** Server-derived lossy condition spec. Absent or empty means the card
     *  renders pristine; arriving after mount attaches the overlay live. */
    wear?: TcgWearSpec | null
}>(), {
    foilEffect: null,
    pattern: null,
    legacySet: null,
    holo: false,
    height: 420,
    bare: false,
    wear: null
})

const emit = defineEmits<{
    /** First frame has actually painted — safe to crossfade this card in. */
    ready: []
}>()

const width = computed(() => Math.round(props.height * ASPECT))
const stage = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const error = ref(false)

let renderer: THREE.WebGLRenderer | null = null
let geometry: THREE.PlaneGeometry | null = null
let material: THREE.ShaderMaterial | null = null
let uniforms: Record<string, { value: unknown }> | null = null
let pending = 0
let removeVisibility: (() => void) | null = null
let wearGeometry: THREE.PlaneGeometry | null = null
let wearMaterial: THREE.ShaderMaterial | null = null

onMounted(async () => {
    // A .client component hydrating with the page renders once as a stub and
    // once for real; template refs only bind after the second render, so the
    // ref can legitimately be null at mount. One tick later it never is.
    if (!stage.value) await nextTick()
    const el = stage.value
    if (!el) return

    const ren = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer = ren
    ren.outputColorSpace = THREE.LinearSRGBColorSpace
    ren.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    ren.setSize(width.value, props.height)
    ren.domElement.style.width = '100%'
    ren.domElement.style.height = '100%'
    el.appendChild(ren.domElement)

    const scene = new THREE.Scene()
    // Orthographic and sized to the card, so the canvas is exactly the card's
    // box and the surrounding page can lay it out like any other element.
    const camera = new THREE.OrthographicCamera(-ASPECT / 2, ASPECT / 2, 0.5, -0.5, 0.1, 10)
    camera.position.z = 5

    // `bundle` is 'sv3-5_en_006'; resolve() rebuilds the face name as
    // `${card}_en_${num}`, so split the family off the bundle and pass the
    // asset number separately. Legacy scans have no bundle — resolveLegacy
    // loads /images/legacy/<set>/<num>.png and foils only when holo.
    const family = props.bundle.split('_en_')[0] ?? props.bundle
    const r = props.legacySet
        ? resolveLegacy({
            set: props.legacySet,
            num: props.assetNumber,
            holo: props.holo
        })
        : resolve({
            card: family,
            num: props.assetNumber,
            mask: props.maskKind,
            effect: ((props.pattern || props.foilEffect) ?? '').toLowerCase(),
            // Alternate-art faces are `<family>_en_<num>_alt` with the marker
            // carried on the stored bundle; resolve() re-appends it.
            alt: props.bundle.endsWith('_alt')
        })
    uniforms = r.uniforms
    geometry = new THREE.PlaneGeometry(ASPECT, 1, 1, 1)
    material = makeMaterial(r.uniforms)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const TILT = 0.5
    const EASE = 0.028
    const SETTLED = 1e-4
    const want = new THREE.Vector2(0.5, 0.5)
    const target = { rx: 0, ry: 0 }
    let hovering = false
    const clock = new THREE.Clock()

    function frame() {
        const dt = Math.min(clock.getDelta(), 0.1)
        mesh.rotation.x += (target.rx - mesh.rotation.x) * EASE
        mesh.rotation.y += (target.ry - mesh.rotation.y) * EASE
        // The light comes from the card's rotation, so it can only move as
        // fast as the card turns.
        r.uniforms.uPointer.value.set(
            0.5 + mesh.rotation.y / TILT,
            0.5 - mesh.rotation.x / TILT
        )
        r.uniforms.uLocal.value.lerp(want, EASE)
        if (hovering) r.uniforms.uTime.value += dt

        ren.render(scene, camera)
        const moving = hovering
            || Math.abs(mesh.rotation.x - target.rx) > SETTLED
            || Math.abs(mesh.rotation.y - target.ry) > SETTLED
        pending = moving && !document.hidden ? requestAnimationFrame(frame) : 0
    }

    function invalidate() {
        if (pending || document.hidden) return
        clock.getDelta()
        pending = requestAnimationFrame(frame)
    }

    // Against the card's own box rather than the tilted mesh, so tilting
    // cannot move the geometry out from under the pointer.
    el.addEventListener('pointermove', (e: PointerEvent) => {
        const b = el.getBoundingClientRect()
        const u = (e.clientX - b.left) / b.width
        const v = 1 - (e.clientY - b.top) / b.height
        hovering = u >= 0 && u <= 1 && v >= 0 && v <= 1
        if (hovering) {
            want.set(u, v)
            target.ry = (u - 0.5) * TILT
            target.rx = (0.5 - v) * TILT
        } else {
            target.rx = 0
            target.ry = 0
        }
        invalidate()
    })
    el.addEventListener('pointerleave', () => {
        hovering = false
        target.rx = 0
        target.ry = 0
        invalidate()
    })

    // ---- Condition wear ----------------------------------------------------
    // Centering is geometry, not overlay: shifting the plane's UVs moves the
    // face and the foil mask together, which is physically correct — a miscut
    // moves the whole print, not just the ink. The wear overlay keeps its own
    // unshifted UVs and paints a cardstock sliver over the clamped spill.
    let wearMesh: THREE.Mesh | null = null
    let eraserMesh: THREE.Mesh | null = null
    let eraserGeometry: THREE.PlaneGeometry | null = null
    let eraserMaterial: THREE.ShaderMaterial | null = null
    let baseUv: Float32Array | null = null

    function applyCentering(dx: number, dy: number) {
        if (!geometry) return
        const uvAttr = geometry.attributes.uv as THREE.BufferAttribute
        if (!baseUv) baseUv = new Float32Array(uvAttr.array as ArrayLike<number>)
        for (let i = 0; i < uvAttr.count; i++) {
            uvAttr.setXY(i, baseUv[i * 2]! - dx, baseUv[i * 2 + 1]! - dy)
        }
        uvAttr.needsUpdate = true
    }

    // The loader defaults everything to RepeatWrapping; with shifted UVs the
    // spill must clamp, or the opposite edge of the print wraps into view.
    function clampFaceTextures() {
        if (!uniforms) return
        for (const key of ['uCard', 'uMask', 'uEtch']) {
            const t = uniforms[key]?.value
            if (t instanceof THREE.Texture) {
                t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
                t.needsUpdate = true
            }
        }
    }

    function syncWear() {
        if (wearMesh) {
            mesh.remove(wearMesh)
            wearMesh = null
        }
        wearMaterial?.dispose()
        wearMaterial = null
        wearGeometry?.dispose()
        wearGeometry = null
        if (eraserMesh) {
            mesh.remove(eraserMesh)
            eraserMesh = null
        }
        eraserMaterial?.dispose()
        eraserMaterial = null
        eraserGeometry?.dispose()
        eraserGeometry = null

        const spec = props.wear
        if (!spec) {
            applyCentering(0, 0)
            invalidate()
            return
        }
        applyCentering(spec.centering.dx, spec.centering.dy)
        clampFaceTextures()
        if (spec.centering.dx !== 0 || spec.centering.dy !== 0) {
            // The shifted UVs drag the foil's rounded-corner clip with the
            // print, leaving a squared overhang at the trailing corners —
            // this pass erases everything outside the die-cut outline before
            // the wear marks draw on top.
            eraserGeometry = new THREE.PlaneGeometry(ASPECT, 1, 1, 1)
            eraserMaterial = makeEraserMaterial()
            eraserMesh = new THREE.Mesh(eraserGeometry, eraserMaterial)
            eraserMesh.position.z = 0.001
            eraserMesh.renderOrder = 1
            mesh.add(eraserMesh)
        }
        const hasContent = spec.corners.length > 0 || spec.edges.length > 0
            || spec.surface.length > 0
            || spec.centering.dx !== 0 || spec.centering.dy !== 0
        if (hasContent) {
            wearGeometry = new THREE.PlaneGeometry(ASPECT, 1, 1, 1)
            // foil.js is vendored untyped JS, so its uniform objects arrive
            // as { value: unknown } — the shapes are fixed by the shader.
            wearMaterial = makeWearMaterial(spec, {
                uPointer: r.uniforms.uPointer,
                uTime: r.uniforms.uTime,
                uCard: r.uniforms.uCard as { value: THREE.Texture | null },
                uCrop: r.uniforms.uCrop as { value: number }
            })
            // A child of the card mesh, so it tilts with it; nudged forward
            // so the marks sit above the foil, as §8.3's layering requires.
            wearMesh = new THREE.Mesh(wearGeometry, wearMaterial)
            wearMesh.position.z = 0.002
            wearMesh.renderOrder = 2
            mesh.add(wearMesh)
        }
        invalidate()
    }

    // The lightbox fetches the spec async, so the prop can appear (or change)
    // after mount and the overlay must attach live.
    syncWear()
    watch(() => props.wear, syncWear, { deep: true })

    // A hidden tab refuses to draw, which is the point — but it has to draw
    // again when it comes back, or switching away and returning leaves a
    // blank card that nothing wakes.
    document.addEventListener('visibilitychange', invalidate)
    removeVisibility = () => document.removeEventListener('visibilitychange', invalidate)

    const apiBase = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
        ?? 'http://127.0.0.1:8080'
    // Missing masks/patterns/etches fall back inside loadCard itself (the
    // vendored foil.js treats a 404 there as "no foil"); only a missing face
    // is a real error.
    const load = makeLoader(ren)
    loadCard(load, r, apiBase)
        .then(() => {
            // The textures only exist now; re-clamp if a wear spec already
            // shifted the UVs before they arrived.
            if (props.wear) clampFaceTextures()
            loading.value = false
            invalidate()
            // invalidate() schedules the first textured frame on the next
            // rAF; one more rAF after that means it has been composited, so
            // a host crossfading over a static print never catches a blank.
            requestAnimationFrame(() => requestAnimationFrame(() => emit('ready')))
        })
        .catch(() => {
            loading.value = false
            error.value = true
        })
})

onBeforeUnmount(() => {
    if (pending) {
        cancelAnimationFrame(pending)
        pending = 0
    }
    removeVisibility?.()
    if (uniforms) {
        for (const u of Object.values(uniforms)) {
            if (u.value instanceof THREE.Texture) u.value.dispose()
        }
        uniforms = null
    }
    material?.dispose()
    material = null
    geometry?.dispose()
    geometry = null
    wearMaterial?.dispose()
    wearMaterial = null
    wearGeometry?.dispose()
    wearGeometry = null
    if (renderer) {
        renderer.domElement.remove()
        renderer.dispose()
        renderer = null
    }
})
</script>

<template>
    <div
        class="relative overflow-hidden"
        :style="{ width: width + 'px', height: props.height + 'px' }"
    >
        <div ref="stage" class="absolute inset-0" />
        <USkeleton v-if="loading && !bare" class="absolute inset-0 rounded-xl" />
        <div
            v-else-if="error"
            class="absolute inset-0 flex items-center justify-center rounded-xl bg-elevated p-3 text-center text-xs text-muted"
        >
            <slot name="error">Could not load card textures</slot>
        </div>
    </div>
</template>
