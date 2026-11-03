<script setup lang="ts">
// Rail Tycoon — the map overview: one pixel per tile on an offscreen canvas (terrain by height,
// water, towns, industries, and rail, roads, stations and depots in their owner's colour), drawn turned
// into the main view's diamond so the camera's viewport is a plain rectangle on it. Dirty tiles from
// the lockstep repaint one by one; a new lockstep repaints everything. A click or drag moves the main
// view there.
import type { RtLockstep } from '~/utils/rail-tycoon/lockstep'
import RtWindow from './RtWindow.vue'
import { useRtGame } from '~/utils/rail-tycoon/windows'
import {
  RT_MINIMAP_WIDTH,
  rtMinimapColour,
  rtMinimapFromWorld,
  rtMinimapScale,
  rtMinimapToWorld
} from '~/utils/rail-tycoon/minimap'

withDefaults(defineProps<{
  windowKey?: string
}>(), {
  windowKey: 'minimap'
})

const game = useRtGame()

const WIDTH = RT_MINIMAP_WIDTH
const HEIGHT = RT_MINIMAP_WIDTH / 2

const canvas = ref<HTMLCanvasElement | null>(null)

/** The map at one pixel per tile, x right and y down; drawn turned onto the visible canvas. */
let tiles: HTMLCanvasElement | null = null
let tileCtx: CanvasRenderingContext2D | null = null
let image: ImageData | null = null
let side = 0
let lockstepOff: (() => void) | null = null
let raf = 0
let drawnVersion = -1
let imageDirty = false
let needsComposite = true
let dpr = 1

function paintTile(ls: RtLockstep, tile: number) {
  if (!image) return
  const colour = rtMinimapColour(ls.world, tile)
  const at = tile * 4
  image.data[at] = (colour >> 16) & 0xff
  image.data[at + 1] = (colour >> 8) & 0xff
  image.data[at + 2] = colour & 0xff
  image.data[at + 3] = 255
}

/** Repaints every tile, after a new lockstep (a resync or reopen brings a fresh world). */
function paintAll(ls: RtLockstep) {
  side = ls.world.map.side
  if (!tiles || tiles.width !== side) {
    tiles = document.createElement('canvas')
    tiles.width = side
    tiles.height = side
    tileCtx = tiles.getContext('2d')
    image = tileCtx?.createImageData(side, side) ?? null
  }
  for (let tile = 0; tile < side * side; tile++) paintTile(ls, tile)
  imageDirty = true
}

function attach(ls: RtLockstep | null) {
  lockstepOff?.()
  lockstepOff = null
  if (!ls) return
  paintAll(ls)
  lockstepOff = ls.on('dirty', (dirty) => {
    for (const tile of dirty) if (tile >= 0 && tile < side * side) paintTile(ls, tile)
    imageDirty = true
  })
}

watch(() => game.lockstep.value, ls => attach(ls))

/** Puts the tile image and the viewport rectangle on the visible canvas. */
function composite() {
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  if (ratio !== dpr || el.width !== Math.round(WIDTH * ratio)) {
    dpr = ratio
    el.width = Math.round(WIDTH * ratio)
    el.height = Math.round(HEIGHT * ratio)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  if (!tiles || side === 0) return
  if (imageDirty && image && tileCtx) {
    tileCtx.putImageData(image, 0, 0)
    imageDirty = false
  }
  const s = rtMinimapScale(side)
  ctx.save()
  // tile (x, y) to ((y - x) * s + WIDTH / 2, (x + y) * s / 2): the main view's projection, scaled
  ctx.transform(-s, s / 2, s, s / 2, WIDTH / 2, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tiles, 0, 0)
  ctx.restore()

  const camera = game.camera
  const tl = camera.screenToWorld(0, 0)
  const br = camera.screenToWorld(camera.width, camera.height)
  const a = rtMinimapFromWorld(side, tl.x, tl.y)
  const b = rtMinimapFromWorld(side, br.x, br.y)
  // whole pixels plus a half, so the 1 px outline stays sharp on a standard screen
  const x = Math.round(a.x) + 0.5
  const y = Math.round(a.y) + 0.5
  const w = Math.max(2, Math.round(b.x - a.x))
  const h = Math.max(2, Math.round(b.y - a.y))
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.strokeRect(x + 1, y + 1, w, h)
  ctx.strokeStyle = '#ffffff'
  ctx.strokeRect(x, y, w, h)
}

function frame() {
  raf = requestAnimationFrame(frame)
  const version = game.camera.version
  if (version !== drawnVersion || imageDirty || needsComposite) {
    drawnVersion = version
    needsComposite = false
    composite()
  }
}

// ─── Moving the main view ────────────────────────────────────────────────

let dragging: number | null = null

function jump(e: PointerEvent) {
  const el = canvas.value
  if (!el || side === 0) return
  const rect = el.getBoundingClientRect()
  const mx = (e.clientX - rect.left) * WIDTH / rect.width
  const my = (e.clientY - rect.top) * HEIGHT / rect.height
  const world = rtMinimapToWorld(side, mx, my)
  game.camera.centreOnWorld(world.x, world.y)
}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  dragging = e.pointerId
  e.preventDefault()
  jump(e)
}

function onMove(e: PointerEvent) {
  if (dragging === e.pointerId) jump(e)
}

function onUp(e: PointerEvent) {
  if (dragging !== e.pointerId) return
  dragging = null
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
}

onMounted(() => {
  attach(game.lockstep.value)
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  lockstepOff?.()
  lockstepOff = null
  tiles = null
  tileCtx = null
  image = null
})
</script>

<template>
  <RtWindow title="Map of the world" :window-key="windowKey">
    <canvas
      ref="canvas"
      class="rt-minimap"
      :style="{ width: `${WIDTH}px` }"
      aria-label="Map of the world: click or drag to move the view"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    />
  </RtWindow>
</template>

<style scoped>
.rt-minimap {
  display: block;
  max-width: 100%;
  height: auto;
  aspect-ratio: 2 / 1;
  border: 1px solid #14120e;
  cursor: crosshair;
  touch-action: none;
  image-rendering: pixelated;
}
</style>
