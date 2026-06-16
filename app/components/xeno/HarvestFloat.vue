<script setup lang="ts">
const props = defineProps<{
  items: Array<{ id: number; x: number; y: number; text: string; colorClass: string }>
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-for="f in items"
      :key="f.id"
      class="pointer-events-none fixed z-[9999] select-none font-black text-sm drop-shadow-lg animate-harvest-float"
      :style="{ left: `${f.x}px`, top: `${f.y}px`, transform: 'translateX(-50%)' }"
      :class="f.colorClass"
    >
      {{ f.text }}
    </div>
  </Teleport>
</template>

<style scoped>
@keyframes harvest-float {
  0%   { opacity: 1; transform: translateX(-50%) translateY(0); }
  20%  { opacity: 1; }
  100% { opacity: 0; transform: translateX(-50%) translateY(-70px); }
}

.animate-harvest-float {
  animation: harvest-float 1.4s ease-out forwards;
}
</style>
