<script setup lang="ts">
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import type { SplashParty } from '~/utils/hero-quest-art/menu-splash'
import { C, PALETTE_RGB } from '~/utils/hero-quest-art/palette'

/**
 * What the Battle tab shows once the run is cleared: the party walking a bridge of light in the
 * dark, and Begin Again. The press goes to the server first; only once `crossing` is set does the
 * party walk into the portal, and `crossed` fires when World 1 fills the screen.
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

const emit = defineEmits<{ begin: [], crossed: [] }>()

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
    const [{ PrestigeBridge, onBeginAgain }, { Presenter, startLoop }] = await Promise.all([
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
            emit('crossed')
        }
    }, () => presenter!.present(bridge.render(t, buttonState.value)))
    observer = new ResizeObserver(fit)
    observer.observe(wrap.value!)
    fit()
    ready.value = true
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
      :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated' }"
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
