<script setup lang="ts">
defineProps<{ bonus?: boolean }>()

// Fixed decorative positions avoid layout shifts and random render differences.
const stars = Array.from({ length: 48 }, (_, i) => ({
  left: `${(i * 37.3) % 100}%`,
  top: `${(i * 23.7) % 100}%`,
  opacity: 0.15 + (i % 5) * 0.1,
  size: i % 6 === 0 ? '3px' : '1px'
}))
</script>

<template>
  <div class="ag-backdrop" :class="{ 'is-bonus': bonus }" aria-hidden="true">
    <div class="ag-nebula" />
    <svg class="ag-orrery" viewBox="0 0 1200 1000" fill="none">
      <g stroke="currentColor">
        <circle cx="600" cy="480" r="410" stroke-width="0.7" />
        <circle cx="600" cy="480" r="430" stroke-width="0.5" stroke-dasharray="2 12" />
        <circle cx="600" cy="480" r="470" stroke-width="0.5" />
        <ellipse cx="600" cy="480" rx="550" ry="230" transform="rotate(-35 600 480)" stroke-width="0.5" />
        <path d="M600 0v45M600 915v45M120 480h35M1045 480h35" />
      </g>
      <g fill="currentColor">
        <path d="m236 200 4 10 10 4-10 4-4 10-4-10-10-4 10-4ZM995 655l4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" />
        <circle cx="976" cy="315" r="4" />
        <circle cx="235" cy="666" r="3" />
      </g>
    </svg>
    <svg class="ag-horizon" viewBox="0 0 1600 500" preserveAspectRatio="xMidYMax slice" fill="none">
      <path d="M0 180 170 240 290 200 480 355 640 290 810 355 1100 185 1300 230 1450 120 1600 180V500H0Z" fill="currentColor" opacity="0.12" />
      <path d="M0 325 220 290 450 430 700 355 950 430 1210 280 1400 345 1600 300V500H0Z" fill="currentColor" opacity="0.18" />
      <g stroke="currentColor" stroke-width="2" opacity="0.2">
        <path d="M80 240V130H210V240M65 130l80-40 80 40ZM70 245H220M95 240V145M125 240V145M165 240V145M195 240V145" />
        <path d="M1380 210V100H1510V210M1365 100l80-40 80 40ZM1370 215H1520M1395 210V115M1425 210V115M1465 210V115M1495 210V115" />
      </g>
    </svg>
    <span v-for="(star, i) in stars" :key="i" class="ag-star" :style="{ left: star.left, top: star.top, opacity: star.opacity, width: star.size, height: star.size }" />
  </div>
</template>

<style scoped>
.ag-backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--ag-night);
  pointer-events: none;
}
.ag-nebula {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 48% 15%, color-mix(in srgb, var(--ag-accent) 13%, transparent), transparent 60%),
    radial-gradient(ellipse at 80% 85%, color-mix(in srgb, var(--ui-secondary) 10%, transparent), transparent 55%);
  transition: opacity 1s ease;
}
.ag-orrery {
  position: absolute;
  width: min(1300px, 140%);
  height: 110%;
  left: 50%;
  top: -5%;
  transform: translateX(-50%);
  color: var(--ag-gold);
  opacity: 0.18;
}
.ag-horizon {
  position: absolute;
  bottom: 0;
  width: 100%;
  height: 50%;
  color: var(--ag-accent);
}
.ag-star {
  position: absolute;
  border-radius: 50%;
  background: var(--ag-text);
}
.is-bonus .ag-nebula {
  opacity: 0.5;
}
.is-bonus .ag-orrery {
  color: var(--ui-secondary);
  opacity: 0.4;
}
</style>
