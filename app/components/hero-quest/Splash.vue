<script setup lang="ts">
import type { Presenter } from '~/utils/hero-quest-art/canvas'
import type { SplashParty } from '~/utils/hero-quest-art/menu-splash'
import { C, PALETTE } from '~/utils/hero-quest-art/palette'
import type { HqIntroRect } from '~/composables/useHqIntro'
import { formatSeconds } from '#shared/utils/hero-quest/numbers'

/**
 * Hero Quest's front door: the animated splash, and the one button that goes in. Begin when
 * there is no run, Start when the player's session has ended (`useHqSession`). It also carries
 * what a long absence earned, since that is what the player comes back wanting to know.
 *
 * The art is `MenuSplash`: the splash's scene and logo with the save's party standing in it, drawn
 * live. It loads as its own chunk, like the battle stage, so nothing outside Hero Quest carries it.
 */
const props = defineProps<{
    mode: 'loading' | 'begin' | 'start'
    away: {
        kills: number
        goldEarned: number
        levelsGained: number
        effectiveSeconds: number
        blockedAtBoss: boolean
    } | null
    /** Begin or Start is on its way to the server. */
    pending?: boolean
    /** Who stands on the splash: the save's party, or the Beginner alone without one. */
    party: SplashParty
    /** The way in is open: close the iris on the Hero, then say `left`. */
    leaving?: boolean
}>()

const emit = defineEmits<{
    begin: []
    start: []
    /** The iris has shut: where the art sat, for the battle stage to grow out of; null when it went straight in. */
    left: [rect: HqIntroRect | null]
}>()

/** The stage's own black, so the shut splash and the shut battle stage are one colour. */
const INK = PALETTE[C.ink]!

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const cssSize = ref({ width: 0, height: 0 })
const ready = ref(false)
const closing = ref(false)
/** The Hero on the splash, as a share of the art: where the iris closes. */
let focus = { x: 0.5, y: 0.5 }

let presenter: Presenter | null = null
let stop: (() => void) | null = null
let observer: ResizeObserver | null = null
let disposed = false

function fit() {
    if (!wrap.value || !presenter) return
    const width = wrap.value.getBoundingClientRect().width
    cssSize.value = presenter.fit(width, width * presenter.h / presenter.w, window.devicePixelRatio || 1)
}

/** Press Play, unless the state is still loading or a press is already on its way. */
function go() {
    if (props.mode === 'loading' || props.pending) return
    if (props.mode === 'begin') emit('begin')
    else emit('start')
}

/**
 * The play button lives in the canvas, so the pointer is hit-tested against it in scene pixels.
 * Keyboard and screen readers reach it through the canvas itself, which is focusable and labelled.
 */
const hover = ref(false)
const pressed = ref(false)
let hitTest: ((x: number, y: number) => boolean) | null = null

function scenePoint(e: PointerEvent): { x: number, y: number } | null {
    if (!canvas.value || !presenter) return null
    const r = canvas.value.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width * presenter.w, y: (e.clientY - r.top) / r.height * presenter.h }
}

function onPointerMove(e: PointerEvent) {
    const p = scenePoint(e)
    hover.value = !!p && !!hitTest?.(p.x, p.y)
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

const buttonState = computed(() => props.pending || props.mode === 'loading'
    ? 'busy' as const
    : pressed.value ? 'pressed' as const : hover.value ? 'hover' as const : 'idle' as const)

// a party changed behind the splash (a new payload) is stood up again
let rebuild: ((party: SplashParty) => void) | null = null
const partyKey = computed(() => [props.party.classId, props.party.heroRow, ...props.party.champions.map(c => `${c.id}:${c.row}`)].join('|'))
watch(partyKey, () => rebuild?.(props.party))

onMounted(async () => {
    const [{ MenuSplash, onPlayButton }, { Presenter, startLoop }] = await Promise.all([
        import('~/utils/hero-quest-art/menu-splash'),
        import('~/utils/hero-quest-art/canvas')
    ])
    if (disposed || !canvas.value) return
    let splash = new MenuSplash(props.party)
    focus = splash.heroFocus
    rebuild = (party) => {
        splash = new MenuSplash(party)
        focus = splash.heroFocus
    }
    presenter = new Presenter(canvas.value, splash.frame.w, splash.frame.h)
    hitTest = onPlayButton
    let t = 0
    stop = startLoop(dt => { t += dt }, () => presenter!.present(splash.render(t, buttonState.value)))
    observer = new ResizeObserver(fit)
    observer.observe(wrap.value!)
    fit()
    ready.value = true
})

/**
 * Going in: the art closes on the Hero, a circle at a time, down to the stage's black. Straight in
 * when there is no art up yet to close, or the player asked for less motion.
 */
watch(() => props.leaving, (leaving) => {
    const el = canvas.value
    const box = wrap.value
    if (!leaving) {
        // still up once it has gone (the way in closed again): open back up
        if (closing.value) {
            closing.value = false
            el?.getAnimations().forEach(a => a.cancel())
        }
        return
    }
    if (closing.value) return
    if (!el || !box || !ready.value || prefersReducedMotion()) {
        emit('left', null)
        return
    }
    closing.value = true
    void irisClose(el, focus).then(() => {
        // cancelled by opening back up: nothing to hand over
        if (closing.value && !disposed) emit('left', rectOf(box))
    })
})

onBeforeUnmount(() => {
    disposed = true
    stop?.()
    observer?.disconnect()
})
</script>

<template>
  <div class="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
    <div
      ref="wrap"
      class="relative w-full overflow-hidden rounded-lg border border-default bg-elevated"
      :class="ready ? '' : 'aspect-video'"
      :style="closing ? { backgroundColor: INK } : undefined"
    >
      <canvas
        ref="canvas"
        class="block mx-auto focus-visible:outline-2 focus-visible:outline-primary"
        :class="hover ? 'cursor-pointer' : ''"
        :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated' }"
        role="button"
        tabindex="0"
        :aria-label="mode === 'begin' ? 'Play: begin the quest' : 'Play'"
        :aria-disabled="mode === 'loading' || pending"
        @pointermove="onPointerMove"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointerleave="onPointerLeave"
        @keydown.enter.prevent="go"
        @keydown.space.prevent="go"
      />
    </div>

    <div
      class="text-center space-y-4 transition-opacity duration-300"
      :class="closing ? 'opacity-0' : ''"
    >
      <UAlert
        v-if="mode === 'start' && away && away.kills > 0"
        class="max-w-xl mx-auto text-left"
        color="primary"
        variant="subtle"
        icon="i-lucide-moon"
        title="While you were away"
        :description="`${formatNumber(away.kills)} kills over ${formatSeconds(away.effectiveSeconds)} of counted time — ${formatNumber(away.goldEarned)} gold`
          + (away.levelsGained > 0 ? `, ${away.levelsGained} level${away.levelsGained === 1 ? '' : 's'}` : '')
          + (away.blockedAtBoss ? '. Your run is parked at a boss.' : '.')"
      />
    </div>
  </div>
</template>
