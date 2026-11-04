<script setup lang="ts">
// Rail Tycoon — window chrome every game panel shares.
//
// A title bar to drag by, a close button, focus-to-front on any press, and a position kept inside
// the window layer on drag and whenever the layer or the window resizes. Escape closes the window
// that holds keyboard focus. With a windowKey it stacks, focuses and closes through useRtWindows;
// without one it is a standalone panel that only emits.
import { useRtWindows } from '~/utils/rail-tycoon/windows'

const props = withDefaults(defineProps<{
  title: string
  /** Initial position in CSS pixels inside the window layer; the registry entry's cascade position by default. */
  position?: { x: number, y: number } | null
  /** The useRtWindows key this window belongs to. */
  windowKey?: string | null
  /** Title bar colour (a company's colour); the default grey otherwise. */
  accent?: string | null
  /** Body width in CSS pixels; the content's own width when unset. */
  width?: number | null
}>(), {
  position: null,
  windowKey: null,
  accent: null,
  width: null
})

const emit = defineEmits<{
  close: []
  focus: []
}>()

const windows = useRtWindows()
const entry = computed(() => props.windowKey ? windows.get(props.windowKey) ?? null : null)

const el = ref<HTMLElement | null>(null)
const start = props.position ?? (entry.value ? { x: entry.value.x, y: entry.value.y } : { x: 48, y: 16 })
const x = ref(start.x)
const y = ref(start.y)
const z = computed(() => entry.value?.z ?? 1)

let drag: { id: number, dx: number, dy: number } | null = null
let observer: ResizeObserver | null = null

/** Keeps the whole window inside its layer; a window bigger than the layer pins to its top-left. */
function clamp(nx: number, ny: number) {
  const self = el.value
  const layer = self?.offsetParent as HTMLElement | null
  if (!self || !layer) {
    x.value = Math.round(nx)
    y.value = Math.round(ny)
    return
  }
  const maxX = Math.max(0, layer.clientWidth - self.offsetWidth)
  const maxY = Math.max(0, layer.clientHeight - self.offsetHeight)
  x.value = Math.round(Math.min(Math.max(0, nx), maxX))
  y.value = Math.round(Math.min(Math.max(0, ny), maxY))
}

function reclamp() {
  clamp(x.value, y.value)
}

function bringToFront() {
  if (props.windowKey) windows.focus(props.windowKey)
  emit('focus')
}

function onPointerDown(e: PointerEvent) {
  bringToFront()
  // keyboard focus moves into the window so Escape reaches it, unless a control takes it itself
  const target = e.target as HTMLElement | null
  if (!target?.closest('button, input, select, textarea, a, [tabindex]:not([tabindex="-1"])')) el.value?.focus({ preventScroll: true })
}

function onBarDown(e: PointerEvent) {
  // a control in the bar keeps its click: capturing the pointer would move the click to the bar
  if (e.button !== 0 || (e.target as HTMLElement | null)?.closest('button, input, select, a')) return
  const bar = e.currentTarget as HTMLElement
  bar.setPointerCapture(e.pointerId)
  drag = { id: e.pointerId, dx: e.clientX - x.value, dy: e.clientY - y.value }
  e.preventDefault()
}

function onBarMove(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  clamp(e.clientX - drag.dx, e.clientY - drag.dy)
}

function onBarUp(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  drag = null
  const bar = e.currentTarget as HTMLElement
  if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId)
}

function close() {
  if (props.windowKey) windows.close(props.windowKey)
  emit('close')
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  // the map's Escape (cancel the tool) is not run for a key meant for this window
  e.stopPropagation()
  e.preventDefault()
  close()
}

onMounted(() => {
  reclamp()
  el.value?.focus({ preventScroll: true })
  window.addEventListener('resize', reclamp)
  if (typeof ResizeObserver !== 'undefined' && el.value) {
    observer = new ResizeObserver(reclamp)
    observer.observe(el.value)
    const layer = el.value.offsetParent
    if (layer) observer.observe(layer)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', reclamp)
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <section
    ref="el"
    class="rt-window"
    role="dialog"
    :aria-label="title"
    tabindex="-1"
    :style="{ left: `${x}px`, top: `${y}px`, zIndex: z }"
    @pointerdown="onPointerDown"
    @keydown="onKeyDown"
  >
    <header
      class="rt-window-bar"
      :style="accent ? { background: accent } : undefined"
      @pointerdown="onBarDown"
      @pointermove="onBarMove"
      @pointerup="onBarUp"
      @pointercancel="onBarUp"
    >
      <span class="rt-window-title">{{ title }}</span>
      <slot name="actions" />
      <button
        type="button"
        class="rt-window-close"
        aria-label="Close"
        @pointerdown.stop="bringToFront"
        @click="close"
      >
        <UIcon name="i-lucide-x" class="size-3.5" />
      </button>
    </header>
    <div class="rt-window-body" :style="width ? { width: `${width}px` } : undefined">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.rt-window {
  position: absolute;
  display: flex;
  flex-direction: column;
  max-width: 100%;
  max-height: 100%;
  border: 1px solid #14120e;
  background: #3a352c;
  color: #ece6d6;
  box-shadow:
    inset 1px 1px 0 #6b6455,
    inset -1px -1px 0 #201d17,
    0 6px 18px rgba(0, 0, 0, 0.45);
  font-size: 12px;
  line-height: 1.35;
  pointer-events: auto;
  outline: none;
}
.rt-window:focus-visible {
  border-color: #c9b98a;
}
.rt-window-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 2px 3px 2px 8px;
  background: #5a5244;
  color: #fff;
  cursor: move;
  touch-action: none;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.35);
}
.rt-window-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rt-window-close {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid rgba(0, 0, 0, 0.45);
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  cursor: pointer;
}
.rt-window-close:hover {
  background: #a3352a;
}
.rt-window-body {
  min-height: 0;
  max-width: 100%;
  overflow: auto;
  padding: 8px;
}
</style>
