<script setup lang="ts">
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import { fitStage, stagePlaceholderWidth } from '~/utils/hero-quest-art/stage-size'
import type { SplashParty } from '~/utils/hero-quest-art/menu-splash'
import { C, PALETTE_RGB } from '~/utils/hero-quest-art/palette'
import type { HqIntroRect } from '~/composables/useHqIntro'
import type { GuideTarget, GuideView } from '~/utils/hero-quest-art/guide'

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
    /** The Void Shards the prestige paid, spelled out, to rise over the Hero once it lands. */
    earned?: string | null
    /** The Void Shards Begin Again will pay, spelled out, shown over the button. */
    reward?: string | null
    /** The menu buttons shown: only the scenes open so far, as on the stage. */
    menuScenes?: readonly HqMenuScene[]
    /** The guide's dialog, while a tutorial is due: the gate is where Prestige opens. */
    guide?: GuideView | null
}>()

const emit = defineEmits<{
    begin: []
    /** The party is through and the iris has shut: its box, or null to go straight in. */
    crossed: [rect: HqIntroRect | null]
    /** A menu band button was pressed. */
    scene: [scene: HqMenuScene]
    /** The guide's panel was pressed: the next page, or the tutorial closed on the last. */
    guideNext: []
}>()

const intro = import.meta.client ? takeHqIntro() : null
/** Shut, while it grows in from the battle stage's box and the art loads. */
const opening = ref(intro !== null)

/** The canvas scales in whole steps, so the frame around it is the scene's own dark. */
const ground = `#${PALETTE_RGB[C.ink]!.toString(16).padStart(6, '0')}`

/** The full-width box the stage is sized into; `wrap` hugs the canvas inside it. */
const frame = ref<HTMLDivElement | null>(null)
const wrap = ref<HTMLDivElement | null>(null)
const { size: stageSize } = useHqStageSize()
/** The loading box's shape, until the art is in and the canvas sizes it. */
const PLACEHOLDER_ASPECT = 320 / 202
const placeholderWidth = ref<number | null>(null)
const placeholder = computed(() => {
    if (ready.value) return {}
    const width = placeholderWidth.value
    return { aspectRatio: `${PLACEHOLDER_ASPECT}`, ...(width === null ? {} : { width: `${width}px` }) }
})
const canvas = ref<HTMLCanvasElement | null>(null)
const cssSize = ref({ width: 0, height: 0 })
const ready = ref(false)

let presenter: Presenter | null = null
let stop: (() => void) | null = null
let observer: ResizeObserver | null = null
let disposed = false

function fit() {
    if (!frame.value || !presenter) return
    cssSize.value = fitStage(presenter, frame.value, stageSize.value)
}

watch(stageSize, fit)

function go() {
    // a tutorial on screen holds the bridge: Begin Again waits until it is read
    if (props.pending || props.crossing || props.guide) return
    emit('begin')
}

/** The button and the menu band live in the canvas, so the pointer is hit-tested against them in scene pixels. */
type Target = 'begin' | HqMenuScene | GuideTarget
const hover = ref<Target | null>(null)
const pressed = ref(false)
let hitTest: ((x: number, y: number) => boolean) | null = null
let band: typeof import('~/utils/hero-quest-art/menu-band') | null = null
let guideHit: typeof import('~/utils/hero-quest-art/guide') | null = null
/** The bridge's height: the band sits under it, and the guide's bar sits on it. */
let sceneH = 0

function targetAt(e: PointerEvent): Target | null {
    // once a prestige is under way the bridge has to stay up until the party is through
    if (!canvas.value || !presenter || props.pending || props.crossing) return null
    const r = canvas.value.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width * presenter.w
    const y = (e.clientY - r.top) / r.height * presenter.h
    // a tutorial is forced: only its bar answers, or for an unlock only the button it points at
    if (props.guide) {
        if (props.guide.focus) {
            const item = band?.menuItemAt(presenter.w, presenter.h, x, y, props.menuScenes) ?? null
            return item === props.guide.focus ? item : null
        }
        return guideHit?.guideTargetAt(presenter.w, sceneH, x, y, props.guide) ?? null
    }
    return band?.menuItemAt(presenter.w, presenter.h, x, y, props.menuScenes) ?? (hitTest?.(x, y) ? 'begin' : null)
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
    else if (hit === 'guide:next') emit('guideNext')
    else emit('scene', hit)
}

function onPointerLeave() {
    hover.value = null
    pressed.value = false
}

const buttonState = computed(() => props.pending
    ? 'busy' as const
    : hover.value !== 'begin' ? 'idle' as const : pressed.value ? 'pressed' as const : 'hover' as const)
const bandHover = computed(() => hover.value === 'begin' || hover.value?.startsWith('guide:') ? null : hover.value as HqMenuScene | null)
const guideHover = computed(() => hover.value === 'guide:next' ? hover.value : null)

let leave: (() => void) | null = null
let gain: ((text: string) => void) | null = null
watch(() => props.crossing, (crossing) => {
    if (crossing) leave?.()
})
watch(() => props.earned, (earned) => {
    if (earned) gain?.(earned)
})

onMounted(async () => {
    if (frame.value) placeholderWidth.value = stagePlaceholderWidth(frame.value, PLACEHOLDER_ASPECT, stageSize.value)
    // painted at that width before the intro measures it
    await nextTick()
    // started before the art loads, so the box never paints in its own place first
    const landed = intro && wrap.value ? growFrom(wrap.value, intro) : Promise.resolve()
    const [{ PrestigeBridge, onBeginAgain, BRIDGE_HERO_FOCUS, BRIDGE_PORTAL_FOCUS }, { Presenter, startLoop }, menuBand, guideArt] = await Promise.all([
        import('~/utils/hero-quest-art/prestige-bridge'),
        import('~/utils/hero-quest-art/canvas'),
        import('~/utils/hero-quest-art/menu-band'),
        import('~/utils/hero-quest-art/guide')
    ])
    if (disposed || !canvas.value) return
    band = menuBand
    guideHit = guideArt
    const bridge = new PrestigeBridge(props.party)
    sceneH = bridge.frame.h
    const banded = new menuBand.BandedFrame(bridge.frame.w, bridge.frame.h)
    presenter = new Presenter(canvas.value, banded.frame.w, banded.frame.h)
    // the iris foci are shares of the bridge, which the band now sits under
    const onBridge = (f: { x: number, y: number }) => ({ x: f.x, y: f.y * bridge.frame.h / banded.frame.h })
    hitTest = onBeginAgain
    let t = 0
    let done = false
    leave = () => bridge.leave(t)
    gain = text => bridge.gain(text)
    if (props.earned) gain(props.earned)
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
        bridge.offer = props.reward ?? null
        const view = bridge.render(t, buttonState.value)
        const frame = banded.compose(view, 'battle', bandHover.value, pressed.value, false, undefined, props.menuScenes)
        // over the whole frame, so the band dims with the bridge; it steps aside once the party starts across
        if (props.guide && !props.pending && !props.crossing) guideArt.drawGuide(frame, view.h, t, props.guide, guideHover.value)
        presenter!.present(frame)
    })
    observer = new ResizeObserver(fit)
    observer.observe(frame.value!)
    // a window only made shorter leaves the frame's width alone
    window.addEventListener('resize', fit)
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
    window.removeEventListener('resize', fit)
})
</script>

<template>
  <div
    ref="frame"
    class="w-full"
  >
    <div
      ref="wrap"
      class="relative mx-auto overflow-hidden rounded-lg border border-default"
      :class="ready ? 'w-fit' : 'w-full'"
      :style="[{ background: ground }, placeholder]"
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
  </div>
</template>
