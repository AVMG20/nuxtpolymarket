<script setup lang="ts">
import { getPlantDisplay } from '#shared/utils/xeno'

// Small leaves drifting out of a harvested plot or a collected pod, teleported
// to <body> so they escape any overflow-hidden tile. Cosmetic only.
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

// Flashes are accepted for compatibility with useXenoFx but no longer drawn:
// the redesign has no glow.
defineProps<{
  particles: XenoBurstParticle[]
  flashes?: XenoFlash[]
}>()

function leafColor(p: XenoBurstParticle): string {
  if (p.color) return p.color
  if (p.plantId && p.id % 2 === 0) {
    const tier = getPlantDisplay(p.plantId)?.tier
    if (tier) return `var(--xg-t${Math.min(9, tier)})`
  }
  return 'var(--xg-accent)'
}
</script>

<template>
  <Teleport to="body">
    <div class="xeno" aria-hidden="true">
      <span
        v-for="p in particles"
        :key="p.id"
        class="xg-particle"
        :style="{ 'left': `${p.x}px`, 'top': `${p.y}px`, '--c': leafColor(p), '--s': `${Math.round(Math.min(12, Math.max(7, p.size * 0.6)))}px`, ...p.style }"
      />
    </div>
  </Teleport>
</template>
