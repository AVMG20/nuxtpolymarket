<script setup lang="ts">
import { BattleDemo, CAMERAS, type CameraId } from '~/utils/hero-quest-art/demo'
import { Presenter, startLoop } from '~/utils/hero-quest-art/canvas'
import { CLASS_NODES } from '#shared/utils/hero-quest/content/classes'
import { WORLDS } from '#shared/utils/hero-quest/content/worlds'
import type { ClassId } from '#shared/utils/hero-quest/types'

/**
 * The live battle vignette: every unit on the IDLE → CHARGE → CAST → RECOVER loop, drawn at
 * 320×180 and blitted at the largest integer scale that fits — fullscreen included. A closer
 * camera crops a smaller window of that frame, which the same fit shows with bigger pixels.
 */
const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const camera = ref<CameraId>('zoom3')
const cssSize = ref<{ width: number, height: number }>({ width: CAMERAS.zoom3.w, height: CAMERAS.zoom3.h })
const world = ref(1)
const classId = ref<ClassId>('class_sorcerer')
const paused = ref(false)
const fullscreen = ref(false)
const fps = useHqArtFps()
const fpsItems = HQ_ART_FPS_OPTIONS.map(n => ({ label: n === 30 ? `${n} fps · default` : `${n} fps`, value: n }))

const worldItems = WORLDS.map(w => ({ label: `${w.index}. ${w.name}`, value: w.index }))
const classItems = CLASS_NODES.map(c => ({ label: c.name, value: c.id }))
const cameraItems = (Object.keys(CAMERAS) as CameraId[]).map(id => ({ label: CAMERAS[id].label, value: id }))
/** Number keys switch the camera live, fullscreen included, where the select can't be reached. */
const CAMERA_KEYS: Readonly<Record<string, CameraId>> = { 1: 'zoom1', 2: 'zoom2', 3: 'zoom3', 4: 'tight' }

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, textarea, [contenteditable="true"]')) return
  const id = CAMERA_KEYS[e.key]
  if (id) camera.value = id
}

const demo = new BattleDemo()
let presenter: Presenter | null = null
let stop: (() => void) | null = null
let observer: ResizeObserver | null = null

function fit() {
  if (!wrap.value || !presenter) return
  const r = wrap.value.getBoundingClientRect()
  const cam = CAMERAS[camera.value]
  cssSize.value = presenter.fit(r.width, fullscreen.value ? r.height : r.width * cam.h / cam.w, window.devicePixelRatio || 1)
}

function onFullscreenChange() {
  fullscreen.value = document.fullscreenElement === wrap.value
  nextTick(fit)
}

async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen()
  else await wrap.value?.requestFullscreen()
}

// a new rate rebuilds every asset, so the stage re-bakes its frames from them
watch([world, classId, fps], () => demo.setup(world.value, classId.value))
watch(paused, p => { demo.paused = p })
// the presenter is sized to its frame, so a new camera gets a new one
watch(camera, (id) => {
  demo.camera = id
  presenter = new Presenter(canvas.value!, CAMERAS[id].w, CAMERAS[id].h)
  fit()
})

onMounted(() => {
  presenter = new Presenter(canvas.value!, CAMERAS[camera.value].w, CAMERAS[camera.value].h)
  demo.camera = camera.value
  demo.setup(world.value, classId.value)
  stop = startLoop(dt => demo.update(dt), () => presenter!.present(demo.render()))
  observer = new ResizeObserver(fit)
  observer.observe(wrap.value!)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('keydown', onKey)
  fit()
})

onBeforeUnmount(() => {
  stop?.()
  observer?.disconnect()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('keydown', onKey)
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
        v-model="camera"
        :items="cameraItems"
        size="xs"
        class="w-40"
      />
      <USelect
        v-model="fps"
        :items="fpsItems"
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
      Every fourth wave is the world's boss making its entrance. Champions change with the world.
      Keys 1–4 switch the camera live, fullscreen included.
    </p>
  </section>
</template>
