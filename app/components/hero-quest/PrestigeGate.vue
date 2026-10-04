<script setup lang="ts">
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import type { SplashParty } from '~/utils/hero-quest-art/menu-splash'
import { C, PALETTE_RGB } from '~/utils/hero-quest-art/palette'
import type { HqIntroRect } from '~/composables/useHqIntro'

/**
 * What the Battle tab shows once the run is cleared: the party walking a bridge of light in the
 * dark, and Begin Again. The press goes to the server first; only once `crossing` is set does the
 * party walk into the portal, an iris closes on it, and `crossed` fires with the box it shut on,
 * for the battle stage to grow out of.
 *
 * Arriving from the battle stage, the bridge grows out of the stage's shut box and opens on the
 * Hero (`useHqIntro`).
 *
 * The stage's menu band runs under it, so the menu scenes stay a press away while the run
 * waits on the bridge.
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
    /** A menu band button was pressed. */
    scene: [scene: HqMenuScene]
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

/** The button and the menu band live in the canvas, so the pointer is hit-tested against them in scene pixels. */
type Target = 'begin' | HqMenuScene
const hover = ref<Target | null>(null)
const pressed = ref(false)
let hitTest: ((x: number, y: number) => boolean) | null = null
let band: typeof import('~/utils/hero-quest-art/menu-band') | null = null

function targetAt(e: PointerEvent): Target | null {
    // once a prestige is under way the bridge has to stay up until the party is through
    if (!canvas.value || !presenter || props.pending || props.crossing) return null
    const r = canvas.value.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width * presenter.w
    const y = (e.clientY - r.top) / r.height * presenter.h
    return band?.menuItemAt(presenter.w, presenter.h, x, y) ?? (hitTest?.(x, y) ? 'begin' : null)
}

function onPointerMove(e: PointerEvent) {
    const was = hover.value
    hover.value = targetAt(e)
    if (hover.value !== was) pressed.value = false
}

function onPointerDown(e: PointerEvent) {
    onPointerMove(e)
    pressed.value = hover.value !== null
}

function onPointerUp(e: PointerEvent) {
    const wasPressed = pressed.value
    onPointerMove(e)
    pressed.value = false
    const hit = hover.value
    if (!wasPressed || !hit) return
    if (hit === 'begin') go()
    else emit('scene', hit)
}

function onPointerLeave() {
    hover.value = null
    pressed.value = false
}

const buttonState = computed(() => props.pending
    ? 'busy' as const
    : hover.value !== 'begin' ? 'idle' as const : pressed.value ? 'pressed' as const : 'hover' as const)
const bandHover = computed(() => hover.value === 'begin' ? null : hover.value)

let leave: (() => void) | null = null
watch(() => props.crossing, (crossing) => {
    if (crossing) leave?.()
})

onMounted(async () => {
    // started before the art loads, so the box never paints in its own place first
    const landed = intro && wrap.value ? growFrom(wrap.value, intro) : Promise.resolve()
    const [{ PrestigeBridge, onBeginAgain, BRIDGE_HERO_FOCUS, BRIDGE_PORTAL_FOCUS }, { Presenter, startLoop }, menuBand] = await Promise.all([
        import('~/utils/hero-quest-art/prestige-bridge'),
        import('~/utils/hero-quest-art/canvas'),
        import('~/utils/hero-quest-art/menu-band')
    ])
    if (disposed || !canvas.value) return
    band = menuBand
    const bridge = new PrestigeBridge(props.party)
    const banded = new menuBand.BandedFrame(bridge.frame.w, bridge.frame.h)
    presenter = new Presenter(canvas.value, banded.frame.w, banded.frame.h)
    // the iris foci are shares of the bridge, which the band now sits under
    const onBridge = (f: { x: number, y: number }) => ({ x: f.x, y: f.y * bridge.frame.h / banded.frame.h })
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
            else void irisClose(el, onBridge(BRIDGE_PORTAL_FOCUS)).then(() => { if (!disposed) emit('crossed', rectOf(box)) })
        }
    }, () => {
        presenter!.present(banded.compose(bridge.render(t, buttonState.value), 'battle', bandHover.value, pressed.value))
    })
    observer = new ResizeObserver(fit)
    observer.observe(wrap.value!)
    fit()
    ready.value = true
    if (intro) {
        void landed.then(async () => {
            if (disposed || !canvas.value) return
            opening.value = false
            await irisOpen(canvas.value, onBridge(BRIDGE_HERO_FOCUS))
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
    :class="ready ? '' : 'aspect-[320/202]'"
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
