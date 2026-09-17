<script setup lang="ts">
// Particle bursts + screen flashes, teleported to <body> so they escape any
// overflow-hidden tile. Cosmetic only — Math.random() is fine here.
export interface XenoBurstParticle {
  id: number
  x: number
  y: number
  plantId?: string
  color?: string
  size: number
  style: Record<string, string>
}

export interface XenoFlash {
  id: number
  style: Record<string, string>
}

defineProps<{
  particles: XenoBurstParticle[]
  flashes: XenoFlash[]
}>()
</script>

<template>
  <Teleport to="body">
    <div v-for="f in flashes" :key="`f${f.id}`" class="xeno-flash" :style="f.style" />
    <div
      v-for="p in particles"
      :key="p.id"
      class="xeno-particle"
      :style="{ left: `${p.x}px`, top: `${p.y}px`, ...p.style }"
    >
      <XenoPlantIcon v-if="p.plantId" :id="p.plantId" :size="p.size" />
      <span
        v-else
        class="block rounded-full"
        :style="{ width: `${p.size}px`, height: `${p.size}px`, background: p.color ?? 'var(--ui-primary)', boxShadow: `0 0 ${p.size}px ${p.color ?? 'var(--ui-primary)'}` }"
      />
    </div>
  </Teleport>
</template>
