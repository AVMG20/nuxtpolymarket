<script setup lang="ts">
import { BattleDemo, CAMERAS, WAVE_KINDS, cameraFor, type WaveKind } from '~/utils/hero-quest-art/demo'
import { Presenter, startLoop } from '~/utils/hero-quest-art/canvas'
import { CLASS_NODES } from '#shared/utils/hero-quest/content/classes'
import { WORLDS } from '#shared/utils/hero-quest/content/worlds'
import type { ClassId } from '#shared/utils/hero-quest/types'

/**
 * The live battle vignette: every unit on the IDLE → CHARGE → CAST → RECOVER loop, drawn at
 * 320×180, cropped to the wave's camera (the Stage camera, or the whole scene for a raid) and
 * blitted at the largest integer scale that fits — fullscreen included.
 */
const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const cssSize = ref<{ width: number, height: number }>({ width: CAMERAS.zoom3.w, height: CAMERAS.zoom3.h })
const world = ref(1)
const classId = ref<ClassId>('class_sorcerer')
const paused = ref(false)
const fullscreen = ref(false)
const waveKind = ref<WaveKind>('regular')
const cam = computed(() => CAMERAS[cameraFor(waveKind.value)])
const waveItems = WAVE_KINDS.map(k => ({ label: k.label, value: k.id }))

const worldItems = WORLDS.map(w => ({ label: `${w.index}. ${w.name}`, value: w.index }))
const classItems = CLASS_NODES.map(c => ({ label: c.name, value: c.id }))

const demo = new BattleDemo()
let presenter: Presenter | null = null
let stop: (() => void) | null = null
let observer: ResizeObserver | null = null

function fit() {
  if (!wrap.value || !presenter) return
  const r = wrap.value.getBoundingClientRect()
  cssSize.value = presenter.fit(r.width, fullscreen.value ? r.height : r.width * cam.value.h / cam.value.w, window.devicePixelRatio || 1)
}

function onFullscreenChange() {
  fullscreen.value = document.fullscreenElement === wrap.value
  nextTick(fit)
}

async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen()
  else await wrap.value?.requestFullscreen()
}

// a new world, class or wave restarts the fight on it; a raid brings the whole-scene camera
watch([world, classId, waveKind], () => {
  demo.setup(world.value, classId.value, waveKind.value)
  if (presenter && (presenter.w !== cam.value.w || presenter.h !== cam.value.h)) {
    presenter = new Presenter(canvas.value!, cam.value.w, cam.value.h)
    fit()
  }
})
watch(paused, p => { demo.paused = p })

onMounted(() => {
  presenter = new Presenter(canvas.value!, cam.value.w, cam.value.h)
  demo.setup(world.value, classId.value, waveKind.value)
  stop = startLoop(dt => demo.update(dt), () => presenter!.present(demo.render()))
  observer = new ResizeObserver(fit)
  observer.observe(wrap.value!)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  fit()
})

onBeforeUnmount(() => {
  stop?.()
  // the dev tools hold on to an unmounted stage; without its frames it costs next to nothing
  demo.dispose()
  observer?.disconnect()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>

<template>
  <section class="rounded-lg border border-default bg-elevated/40 p-4 space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-medium text-highlighted mr-auto">
        Live stage
      </h2>
      <USelect
        v-model="world"
        :items="worldItems"
        size="xs"
        class="w-48"
      />
      <USelect
        v-model="classId"
        :items="classItems"
        size="xs"
        class="w-40"
      />
      <USelect
        v-model="waveKind"
        :items="waveItems"
        size="xs"
        class="w-36"
      />
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
        :aria-label="paused ? 'Play' : 'Pause'"
        @click="paused = !paused"
      />
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-lucide-maximize"
        aria-label="Fullscreen"
        @click="toggleFullscreen"
      />
    </div>
    <div
      ref="wrap"
      class="flex items-center justify-center w-full"
      :class="fullscreen ? 'bg-black h-screen' : ''"
    >
      <canvas
        ref="canvas"
        class="block"
        :style="{ width: `${cssSize.width}px`, height: `${cssSize.height}px`, imageRendering: 'pixelated' }"
      />
    </div>
    <p class="text-xs text-muted">
      The wave picked is fought over and over, a boss making its entrance each time. Champions change with the world.
    </p>
  </section>
</template>
