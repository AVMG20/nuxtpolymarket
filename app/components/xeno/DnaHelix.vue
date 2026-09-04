<script setup lang="ts">
withDefaults(defineProps<{ width?: number; height?: number; mutation?: boolean }>(), { width: 120, height: 48, mutation: false })

// Two strands as sampled sine waves over a 160px period (double the visible
// 80px scroll so the loop is seamless) plus the rungs connecting them.
const PERIOD = 80
const AMPL = 16
const points = Array.from({ length: 41 }, (_, i) => {
  const x = i * 4
  const phase = (x / PERIOD) * Math.PI * 2
  return { x, a: 24 + Math.sin(phase) * AMPL, b: 24 - Math.sin(phase) * AMPL, depth: Math.cos(phase) }
})
const strandA = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.a.toFixed(2)}`).join(' ')
const strandB = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.b.toFixed(2)}`).join(' ')
const rungs = points.filter((_, i) => i % 3 === 0)
</script>

<template>
  <svg :width="width" :height="height" viewBox="0 0 120 48" class="overflow-hidden" aria-hidden="true">
    <defs>
      <linearGradient id="xeno-helix-fade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="white" stop-opacity="0" />
        <stop offset="0.2" stop-color="white" stop-opacity="1" />
        <stop offset="0.8" stop-color="white" stop-opacity="1" />
        <stop offset="1" stop-color="white" stop-opacity="0" />
      </linearGradient>
      <mask id="xeno-helix-mask"><rect width="120" height="48" fill="url(#xeno-helix-fade)" /></mask>
    </defs>
    <g mask="url(#xeno-helix-mask)">
      <g class="xeno-helix-scroll">
        <g v-for="n in 2" :key="n" :transform="`translate(${(n - 1) * 160} 0)`">
          <line
            v-for="(p, i) in rungs" :key="`r${i}`"
            :x1="p.x" :y1="p.a" :x2="p.x" :y2="p.b"
            :stroke="mutation ? 'var(--ui-secondary)' : 'var(--ui-primary)'"
            :stroke-opacity="0.25 + (p.depth + 1) * 0.2"
            stroke-width="1.5"
          />
          <path :d="strandA" fill="none" :stroke="mutation ? 'var(--ui-secondary)' : 'var(--ui-primary)'" stroke-width="2.5" stroke-linecap="round" />
          <path :d="strandB" fill="none" :stroke="mutation ? 'var(--ui-secondary)' : 'var(--ui-primary)'" stroke-width="2.5" stroke-linecap="round" stroke-opacity="0.55" />
          <circle
            v-for="(p, i) in rungs" :key="`d${i}`"
            :cx="p.x" :cy="p.a" :r="2.2 + (p.depth + 1) * 0.8"
            :fill="mutation ? 'var(--ui-secondary)' : 'var(--ui-primary)'"
          />
        </g>
      </g>
    </g>
  </svg>
</template>
