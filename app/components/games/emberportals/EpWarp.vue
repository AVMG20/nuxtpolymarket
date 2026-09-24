<script setup lang="ts">
// The bonus-trigger portal: a giant burning vortex opens over the whole game,
// swallows it, then burns away to reveal the bonus sky. Pure CSS on top of the
// portal art; `ring` is a data URL of the portal ring.
defineProps<{ ring: string, color: string }>()
</script>

<template>
  <div class="ep-warp" :style="{ '--warp': color }" aria-hidden="true">
    <div class="ep-warp__flash" />
    <div class="ep-warp__hole">
      <div class="ep-warp__swirl" />
      <div class="ep-warp__swirl ep-warp__swirl--b" />
      <img v-if="ring" :src="ring" alt="" class="ep-warp__ring">
    </div>
  </div>
</template>

<style scoped>
.ep-warp {
  position: absolute;
  inset: 0;
  z-index: 60;
  overflow: hidden;
  pointer-events: none;
}

.ep-warp__flash {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle, #fff 0%, #ffd9a0 30%, var(--warp) 60%, transparent 85%);
  mix-blend-mode: screen;
  animation: ep-warp-flash 2.4s ease-out forwards;
}

.ep-warp__hole {
  position: absolute;
  left: 50%;
  top: 42%;
  width: 60vmin;
  aspect-ratio: 1;
  translate: -50% -50%;
  animation: ep-warp-open 2.4s cubic-bezier(0.5, 0, 0.3, 1) forwards;
}

.ep-warp__swirl {
  position: absolute;
  inset: 8%;
  border-radius: 50%;
  background:
    radial-gradient(circle, #000 0%, #120404 22%, transparent 48%),
    repeating-conic-gradient(from 0deg, var(--warp) 0deg 14deg, #ffcf6a 18deg, #2a0a02 30deg 44deg);
  filter: blur(2px);
  animation: ep-warp-spin 1.1s linear infinite;
  box-shadow: 0 0 80px 30px var(--warp), inset 0 0 60px 20px #000;
}

.ep-warp__swirl--b {
  inset: 20%;
  opacity: 0.7;
  mix-blend-mode: screen;
  animation-duration: 0.7s;
  animation-direction: reverse;
}

.ep-warp__ring {
  position: absolute;
  inset: -12%;
  width: 124%;
  height: 124%;
  filter: drop-shadow(0 0 30px var(--warp)) brightness(1.3);
  animation: ep-warp-spin 3s linear infinite reverse;
}

@keyframes ep-warp-open {
  0% { transform: scale(0) rotate(0deg); opacity: 1; }
  40% { transform: scale(1) rotate(160deg); opacity: 1; }
  78% { transform: scale(5) rotate(320deg); opacity: 1; }
  100% { transform: scale(7) rotate(380deg); opacity: 0; }
}

@keyframes ep-warp-flash {
  0% { opacity: 0; }
  8% { opacity: 1; }
  30% { opacity: 0.2; }
  70% { opacity: 0.9; }
  100% { opacity: 0; }
}

@keyframes ep-warp-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ep-warp__flash { animation-duration: 1.2s; opacity: 0.3; }
  .ep-warp__swirl { animation: none; }
}
</style>
