<script setup lang="ts">
// Glass incubation capsule. The liquid level tracks `pct`; the surface wave
// and bubbles run only while breeding so an idle pod reads as dormant.
const props = withDefaults(defineProps<{
  pct?: number
  state?: 'idle' | 'breeding' | 'ready' | 'mutation'
}>(), { pct: 0, state: 'idle' })

const active = computed(() => props.state !== 'idle')
const level = computed(() => (props.state === 'ready' || props.state === 'mutation') ? 100 : Math.min(100, Math.max(0, props.pct)))
// Liquid occupies y 20 → 170 inside the capsule; translate a full-height
// rect down by the unfilled fraction.
const liquidShift = computed(() => 150 * (1 - level.value / 100))

const bubbles = Array.from({ length: 9 }, (_, i) => ({
  id: i,
  cx: 34 + (i * 37) % 52,
  r: 1.6 + (i % 3) * 0.9,
  style: { '--dur': `${2.6 + (i % 4) * 0.7}s`, '--delay': `${-(i * 0.9)}s` }
}))
</script>

<template>
  <div class="relative select-none" :data-state="state">
    <svg viewBox="0 0 120 190" class="w-full h-full" aria-hidden="true">
      <defs>
        <clipPath id="xeno-pod-clip">
          <rect x="22" y="20" width="76" height="150" rx="38" />
        </clipPath>
        <linearGradient id="xeno-pod-glass" x1="0" x2="1">
          <stop offset="0" stop-color="white" stop-opacity="0.18" />
          <stop offset="0.35" stop-color="white" stop-opacity="0.02" />
          <stop offset="0.75" stop-color="white" stop-opacity="0" />
          <stop offset="1" stop-color="white" stop-opacity="0.12" />
        </linearGradient>
        <radialGradient id="xeno-pod-halo">
          <stop offset="0" stop-color="var(--ui-primary)" stop-opacity="0.55" />
          <stop offset="1" stop-color="var(--ui-primary)" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="xeno-pod-halo-mut">
          <stop offset="0" stop-color="var(--ui-secondary)" stop-opacity="0.6" />
          <stop offset="1" stop-color="var(--ui-secondary)" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- halo -->
      <ellipse
        v-if="active"
        cx="60" cy="95" rx="58" ry="80"
        :fill="state === 'mutation' ? 'url(#xeno-pod-halo-mut)' : 'url(#xeno-pod-halo)'"
        class="xeno-pod-glow"
      />

      <!-- base plate -->
      <ellipse cx="60" cy="178" rx="40" ry="7" fill="color-mix(in srgb, var(--ui-bg) 60%, black)" />
      <rect x="30" y="166" width="60" height="12" rx="4" fill="color-mix(in srgb, var(--ui-bg-elevated) 70%, black)" stroke="var(--ui-border)" />
      <rect x="40" y="10" width="40" height="14" rx="4" fill="color-mix(in srgb, var(--ui-bg-elevated) 70%, black)" stroke="var(--ui-border)" />
      <!-- indicator lights on the base -->
      <circle cx="42" cy="172" r="2" :fill="active ? 'var(--ui-primary)' : 'var(--ui-border)'" :class="active ? 'xeno-pod-glow' : ''" />
      <circle cx="50" cy="172" r="2" :fill="level > 50 ? 'var(--ui-primary)' : 'var(--ui-border)'" />
      <circle cx="58" cy="172" r="2" :fill="level >= 100 ? 'var(--ui-primary)' : 'var(--ui-border)'" />

      <!-- liquid -->
      <g clip-path="url(#xeno-pod-clip)">
        <rect x="22" y="20" width="76" height="150" fill="color-mix(in srgb, var(--ui-bg) 45%, transparent)" />
        <g :style="{ transform: `translateY(${liquidShift}px)` }" class="xeno-pod-liquid-wrap" style="transition: transform 1s linear">
          <path
            d="M-20 26 Q-5 20 10 26 T40 26 T70 26 T100 26 T130 26 T160 26 V190 H-20 Z"
            class="xeno-pod-liquid"
            :class="[state === 'mutation' ? 'xeno-pod-liquid-mutation' : '', active ? 'xeno-pod-wave' : '']"
          />
          <path
            d="M-20 30 Q-5 24 10 30 T40 30 T70 30 T100 30 T130 30 T160 30 V190 H-20 Z"
            fill="color-mix(in srgb, var(--ui-primary) 25%, transparent)"
            :class="active ? 'xeno-pod-wave' : ''"
            style="animation-duration: 4.6s; animation-direction: reverse"
          />
        </g>
        <g v-if="active">
          <circle
            v-for="b in bubbles" :key="b.id"
            :cx="b.cx" cy="160" :r="b.r"
            class="xeno-bubble"
            :style="b.style"
          />
        </g>
      </g>

      <!-- glass -->
      <rect x="22" y="20" width="76" height="150" rx="38" fill="url(#xeno-pod-glass)" stroke="color-mix(in srgb, var(--ui-text) 22%, transparent)" stroke-width="1.5" />
      <path d="M32 54 Q30 95 34 136" stroke="white" stroke-opacity="0.25" stroke-width="3" stroke-linecap="round" />
    </svg>
    <div class="absolute inset-0 flex items-center justify-center">
      <slot />
    </div>
  </div>
</template>
