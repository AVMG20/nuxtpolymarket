<script setup lang="ts">
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import type { SplashParty } from '~/utils/hero-quest-art/menu-splash'
import { C, PALETTE_RGB } from '~/utils/hero-quest-art/palette'
import type { HqIntroRect } from '~/composables/useHqIntro'

/**
 * What the Battle tab shows once the run is cleared: the party walking a bridge of light in the
 * dark, and Begin Again. The press goes to the server first; only once `crossing` is set does the
 * party walk into the portal, World 1 fills the screen, an iris closes on the portal, and
 * `crossed` fires with the box it shut on, for the battle stage to grow out of.
 *
 * Arriving from the battle stage, the bridge grows out of the stage's shut box and opens on the
 * Hero (`useHqIntro`).
 *
 * The art is `PrestigeBridge`, loaded as its own chunk like the splash and the battle stage.
 */
const props = defineProps<{
    party: SplashParty
    /** The prestige is on its way to the server. */
    pending?: boolean
    /** The server has prestiged: the party walks into the portal. */
    crossing?: boolean
}>()

const emit = defineEmits<{
    begin: []
    /** The party is through and the iris has shut: its box, or null to go straight in. */
    crossed: [rect: HqIntroRect | null]
}>()

const intro = import.meta.client ? takeHqIntro() : null
/** Shut, while it grows in from the battle stage's box and the art loads. */
const opening = ref(intro !== null)

/** The canvas scales in whole steps, so the frame around it is the scene's own dark. */
const ground = `#${PALETTE_RGB[C.ink]!.toString(16).padStart(6, '0')}`

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const cssSize = ref({ width: 0, height: 0 })
const ready = ref(false)

let presenter: Presenter | null = null
let stop: (() => void) | null = null
let observer: ResizeObserver | null = null
let disposed = false

function fit() {
    if (!wrap.value || !presenter) return
    const width = wrap.value.getBoundingClientRect().width
    cssSize.value = presenter.fit(width, width * presenter.h / presenter.w, window.devicePixelRatio || 1)
}

function go() {
    if (props.pending || props.crossing) return
    emit('begin')
}

/** The button lives in the canvas, so the pointer is hit-tested against it in scene pixels. */
const hover = ref(false)
const pressed = ref(false)
let hitTest: ((x: number, y: number) => boolean) | null = null

function onPointerMove(e: PointerEvent) {
    if (!canvas.value || !presenter || props.crossing) {
        hover.value = false
        return
    }
    const r = canvas.value.getBoundingClientRect()
    hover.value = !!hitTest?.((e.clientX - r.left) / r.width * presenter.w, (e.clientY - r.top) / r.height * presenter.h)
    if (!hover.value) pressed.value = false
}

function onPointerDown(e: PointerEvent) {
    onPointerMove(e)
    pressed.value = hover.value
}

function onPointerUp(e: PointerEvent) {
    const wasPressed = pressed.value
    onPointerMove(e)
    pressed.value = false
    if (wasPressed && hover.value) go()
}

function onPointerLeave() {
    hover.value = false
    pressed.value = false
}

const buttonState = computed(() => props.pending
    ? 'busy' as const
    : pressed.value ? 'pressed' as const : hover.value ? 'hover' as const : 'idle' as const)

let leave: (() => void) | null = null
watch(() => props.crossing, (crossing) => {
    if (crossing) leave?.()
})

onMounted(async () => {
    // started before the art loads, so the box never paints in its own place first
    const landed = intro && wrap.value ? growFrom(wrap.value, intro) : Promise.resolve()
    const [{ PrestigeBridge, onBeginAgain, BRIDGE_HERO_FOCUS, BRIDGE_PORTAL_FOCUS }, { Presenter, startLoop }] = await Promise.all([
        import('~/utils/hero-quest-art/prestige-bridge'),
        import('~/utils/hero-quest-art/canvas')
    ])
    if (disposed || !canvas.value) return
    const bridge = new PrestigeBridge(props.party)
    presenter = new Presenter(canvas.value, bridge.frame.w, bridge.frame.h)
    hitTest = onBeginAgain
    let t = 0
    let done = false
    leave = () => bridge.leave(t)
    if (props.crossing) leave()
    stop = startLoop((dt) => {
        t += dt
        if (!done && bridge.finished(t)) {
            done = true
            const el = canvas.value
            const box = wrap.value
            if (!el || !box || prefersReducedMotion()) emit('crossed', null)
            else void irisClose(el, BRIDGE_PORTAL_FOCUS).then(() => { if (!disposed) emit('crossed', rectOf(box)) })
        }
    }, () => presenter!.present(bridge.render(t, buttonState.value)))
    observer = new ResizeObserver(fit)
    observer.observe(wrap.value!)
    fit()
    ready.value = true
    if (intro) {
        void landed.then(async () => {
            if (disposed || !canvas.value) return
            opening.value = false
            await irisOpen(canvas.value, BRIDGE_HERO_FOCUS)
        })
    }
})

onBeforeUnmount(() => {
    disposed = true
    stop?.()
    observer?.disconnect()
})
</script>

<template>
  <div
    ref="wrap"
    class="relative w-full overflow-hidden rounded-lg border border-default"
    :class="ready ? '' : 'aspect-video'"
    :style="{ background: ground }"
  >
    <canvas
      ref="canvas"
      class="block mx-auto focus-visible:outline-2 focus-visible:outline-primary"
      :class="hover ? 'cursor-pointer' : ''"
      :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated', clipPath: opening ? 'circle(0px)' : undefined }"
      role="button"
      tabindex="0"
      aria-label="Begin again: prestige and return to World 1"
      :aria-disabled="pending || crossing"
      @pointermove="onPointerMove"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @keydown.enter.prevent="go"
      @keydown.space.prevent="go"
    />
  </div>
</template>
