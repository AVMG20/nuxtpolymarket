<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 40 })
</script>

<template>
  <!-- Stylised xenoflora bulb: a glowing seed pod with three tendrils and an orbit ring. -->
  <svg :width="size" :height="size" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shrink-0">
    <defs>
      <radialGradient id="xeno-logo-core" cx="50%" cy="45%" r="55%">
        <stop offset="0%" stop-color="white" stop-opacity="0.9" />
        <stop offset="35%" stop-color="var(--ui-primary)" stop-opacity="0.95" />
        <stop offset="100%" stop-color="var(--ui-primary)" stop-opacity="0.25" />
      </radialGradient>
      <linearGradient id="xeno-logo-tendril" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="var(--ui-primary)" stop-opacity="0.35" />
        <stop offset="100%" stop-color="var(--ui-primary)" />
      </linearGradient>
    </defs>
    <!-- orbit ring -->
    <g class="xeno-orbit" style="transform-origin: 32px 34px">
      <ellipse cx="32" cy="34" rx="27" ry="10" stroke="var(--ui-primary)" stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="4 5" />
      <circle cx="59" cy="34" r="2.2" fill="var(--ui-primary)" />
    </g>
    <!-- tendrils -->
    <path d="M32 44C32 34 22 30 18 20" stroke="url(#xeno-logo-tendril)" stroke-width="3" stroke-linecap="round" />
    <path d="M32 44C32 32 42 30 46 18" stroke="url(#xeno-logo-tendril)" stroke-width="3" stroke-linecap="round" />
    <path d="M32 44C32 36 32 28 32 14" stroke="url(#xeno-logo-tendril)" stroke-width="3" stroke-linecap="round" />
    <circle cx="18" cy="19" r="3" fill="var(--ui-primary)" />
    <circle cx="46" cy="17" r="3" fill="var(--ui-primary)" />
    <circle cx="32" cy="13" r="3.4" fill="var(--ui-primary)" />
    <!-- seed pod -->
    <path d="M32 58C40 58 45 52 45 45C45 38 38 34 32 34C26 34 19 38 19 45C19 52 24 58 32 58Z" fill="url(#xeno-logo-core)" />
    <path d="M32 58C40 58 45 52 45 45C45 38 38 34 32 34C26 34 19 38 19 45C19 52 24 58 32 58Z" stroke="var(--ui-primary)" stroke-width="1.5" stroke-opacity="0.7" />
    <path d="M26 42C28 39 36 39 38 42" stroke="white" stroke-opacity="0.6" stroke-width="1.5" stroke-linecap="round" />
  </svg>
</template>
