<script setup lang="ts">
// Particle bursts, floats and screen flashes, teleported to <body> so they
// escape any overflow-hidden card. Cosmetic only.
const { floats, particles, flashes } = useColonyFx()
</script>

<template>
  <Teleport to="body">
    <div
      v-for="f in flashes"
      :key="`f${f.id}`"
      class="colony-fx-flash"
      :style="f.style"
    />
    <div
      v-for="p in particles"
      :key="`p${p.id}`"
      class="colony-fx-particle"
      :style="{ left: `${p.x}px`, top: `${p.y}px`, ...p.style }"
    >
      <span
        v-if="p.emoji"
        class="block leading-none"
        :style="{ fontSize: `${p.size}px` }"
      >{{ p.emoji }}</span>
      <span
        v-else
        class="block rounded-full"
        :style="{ width: `${p.size * 0.5}px`, height: `${p.size * 0.5}px`, background: p.color ?? 'var(--ui-primary)', boxShadow: `0 0 ${p.size * 0.6}px ${p.color ?? 'var(--ui-primary)'}` }"
      />
    </div>
    <div
      v-for="f in floats"
      :key="`t${f.id}`"
      class="colony-fx-float"
      :class="f.colorClass"
      :style="{ left: `${f.x}px`, top: `${f.y}px` }"
    >
      {{ f.text }}
    </div>
  </Teleport>
</template>

<style>
.colony-fx-particle {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: colony-fx-burst var(--dur, 0.9s) cubic-bezier(0.15, 0.8, 0.3, 1) forwards;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
}
@keyframes colony-fx-burst {
  0% { transform: translate(-50%, -50%) scale(0.4) rotate(0deg); opacity: 1; }
  60% { opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy) + 40px)) scale(1) rotate(var(--rot)); opacity: 0; }
}
.colony-fx-flash {
  position: fixed;
  inset: 0;
  z-index: 9998;
  pointer-events: none;
  background: radial-gradient(circle at var(--fx) var(--fy), color-mix(in srgb, var(--fc) 45%, transparent), transparent 40%);
  animation: colony-fx-flash 0.8s ease-out forwards;
}
@keyframes colony-fx-flash {
  0% { opacity: 0; }
  15% { opacity: 1; }
  100% { opacity: 0; }
}
.colony-fx-float {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  font-weight: 900;
  font-size: 1rem;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8), 0 0 14px rgba(245, 179, 66, 0.5);
  animation: colony-fx-float 1.5s ease-out forwards;
}
@keyframes colony-fx-float {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
  15% { opacity: 1; transform: translate(-50%, -90%) scale(1.2); }
  100% { opacity: 0; transform: translate(-50%, -260%) scale(1); }
}
</style>
