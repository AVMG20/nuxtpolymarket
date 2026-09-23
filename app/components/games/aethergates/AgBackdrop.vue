<script setup lang="ts">
import { drawAgBackdrop } from '~/utils/slots/aethergates-art'

// The sky temple behind the cabinet: a canvas painting redrawn on resize,
// with slow CSS light rays and drifting motes on top. During free spins the
// scene shifts to a stormy violet.

defineProps<{ bonus?: boolean }>()

const root = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
let observer: ResizeObserver | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function paint() {
  const el = root.value
  const cv = canvas.value
  if (!el || !cv) return
  const w = Math.max(1, el.clientWidth)
  const h = Math.max(1, el.clientHeight)
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawAgBackdrop(ctx, w, h)
}

// Cosmetic positions for the drifting motes.
const motes = Array.from({ length: 26 }, (_, i) => ({
  left: `${(i * 37.3) % 100}%`,
  delay: `${-((i * 1.7) % 14)}s`,
  duration: `${12 + (i % 7) * 2}s`,
  size: `${2 + (i % 4)}px`
}))

onMounted(() => {
  paint()
  observer = new ResizeObserver(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(paint, 120)
  })
  if (root.value) observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div
    ref="root"
    class="ag-backdrop"
    :class="{ 'is-bonus': bonus }"
    aria-hidden="true"
  >
    <canvas
      ref="canvas"
      class="ag-backdrop-canvas"
    />
    <div class="ag-rays" />
    <div class="ag-storm" />
    <span
      v-for="(m, i) in motes"
      :key="i"
      class="ag-mote"
      :style="{ left: m.left, animationDelay: m.delay, animationDuration: m.duration, width: m.size, height: m.size }"
    />
  </div>
</template>

<style scoped>
.ag-backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #120b2e;
}

.ag-backdrop-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transition: filter 1.2s ease;
}

.ag-rays {
  position: absolute;
  left: 50%;
  top: 74%;
  width: 240vmax;
  height: 240vmax;
  transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, rgba(255, 220, 160, 0.07) 0deg 4deg, transparent 4deg 13deg);
  mask-image: radial-gradient(circle, black 0%, transparent 42%);
  animation: ag-rays-turn 90s linear infinite;
  mix-blend-mode: screen;
}

.ag-storm {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 30%, rgba(76, 29, 149, 0.2), rgba(8, 6, 30, 0.75));
  opacity: 0;
  transition: opacity 1.2s ease;
}

.is-bonus .ag-storm {
  opacity: 1;
  animation: ag-storm-flash 7s ease-in-out infinite;
}

.is-bonus .ag-backdrop-canvas {
  filter: hue-rotate(-35deg) saturate(1.2) brightness(0.8);
}

.ag-mote {
  position: absolute;
  bottom: -10px;
  border-radius: 999px;
  background: radial-gradient(circle, #fff7d6, rgba(252, 211, 77, 0.6) 50%, transparent 70%);
  box-shadow: 0 0 8px rgba(252, 211, 77, 0.6);
  animation-name: ag-mote-rise;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  opacity: 0;
}

.is-bonus .ag-mote {
  background: radial-gradient(circle, #ecfeff, rgba(103, 232, 249, 0.7) 50%, transparent 70%);
  box-shadow: 0 0 8px rgba(103, 232, 249, 0.7);
}

@keyframes ag-rays-turn {
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes ag-mote-rise {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  10% {
    opacity: 0.9;
  }
  100% {
    transform: translate(40px, -105vh);
    opacity: 0;
  }
}

@keyframes ag-storm-flash {
  0%, 88%, 100% {
    background-color: transparent;
  }
  90% {
    background-color: rgba(165, 243, 252, 0.12);
  }
  92% {
    background-color: transparent;
  }
  94% {
    background-color: rgba(165, 243, 252, 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ag-rays,
  .ag-mote,
  .is-bonus .ag-storm {
    animation: none;
  }
}
</style>
