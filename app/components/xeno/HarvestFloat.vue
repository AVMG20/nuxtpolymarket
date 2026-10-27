<script setup lang="ts">
// "+3" chips that float up from a harvested plot. Teleported, so the layer
// carries the .xeno scope itself.
defineProps<{
  items: Array<{ id: number, x: number, y: number, count: number, colorClass: string, plantId?: string, emoji?: string, label?: string }>
}>()
</script>

<template>
  <Teleport to="body">
    <div class="xeno" aria-hidden="true">
      <div
        v-for="f in items"
        :key="f.id"
        class="xg-float"
        :style="{ left: `${f.x}px`, top: `${f.y}px` }"
      >
        <b>+{{ formatNumber(f.count) }}</b>
        <XenoPlantIcon v-if="f.plantId" :id="f.plantId" :size="20" />
        <span v-else-if="f.emoji === '🪙'" class="xg-coin" />
        <span v-else-if="f.emoji" class="text-sm leading-none">{{ f.emoji }}</span>
        <span v-if="f.label" class="text-[10px] uppercase tracking-wider text-(--xg-muted)">{{ f.label }}</span>
      </div>
    </div>
  </Teleport>
</template>
