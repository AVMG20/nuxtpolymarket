<script setup lang="ts">
defineProps<{
  items: Array<{ id: number; x: number; y: number; count: number; colorClass: string; plantId?: string; emoji?: string; label?: string }>
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-for="f in items"
      :key="f.id"
      class="xeno-float pointer-events-none fixed z-[9999] flex select-none items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 font-black text-sm shadow-lg backdrop-blur-sm"
      :style="{ left: `${f.x}px`, top: `${f.y}px` }"
      :class="f.colorClass"
    >
      <span class="tabular-nums">+{{ f.count }}</span>
      <XenoPlantIcon v-if="f.plantId" :id="f.plantId" :size="20" />
      <span v-else-if="f.emoji">{{ f.emoji }}</span>
      <span v-if="f.label" class="text-[10px] font-bold uppercase tracking-wider opacity-80">{{ f.label }}</span>
    </div>
  </Teleport>
</template>
