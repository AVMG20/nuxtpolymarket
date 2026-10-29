<script setup lang="ts">
import { getPlantDisplay } from '#shared/utils/xeno'

// Inline receipt for Harvest All: what came in, roughly what it is worth, and
// a shortcut to sell the surplus.
export interface HarvestDrop {
  id: string
  name: string
  count: number
  isHybrid?: boolean
}

const props = defineProps<{
  drops: HarvestDrop[]
  slots: number
  replanted: number
}>()
defineEmits<{ close: [] }>()

const plants = computed(() => props.drops.filter(d => !d.isHybrid))
const total = computed(() => plants.value.reduce((s, d) => s + d.count, 0))
const worth = computed(() => plants.value.reduce((s, d) => s + d.count * (getPlantDisplay(d.id)?.value ?? 0), 0))
const regrown = computed(() => props.drops.filter(d => d.isHybrid).reduce((s, d) => s + d.count, 0))
const shown = computed(() => plants.value.slice(0, 8))
</script>

<template>
  <section class="xg-pane is-go xg-pop px-4 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-3" aria-live="polite">
    <div class="flex-[1_1_200px] min-w-0">
      <p class="xg-label !text-(--xg-accent-text)">Harvested {{ slots }} planter{{ slots === 1 ? '' : 's' }}<template v-if="replanted"> · {{ replanted }} replanted</template></p>
      <p class="xg-num text-xl font-extrabold mt-0.5">
        +{{ formatNumber(total) }} plants
        <span v-if="worth > 0" class="text-sm font-semibold text-(--xg-muted)">worth about {{ formatNumber(worth) }}</span>
      </p>
      <p v-if="regrown" class="text-xs text-(--xg-muted) mt-0.5">{{ regrown }} hybrid{{ regrown === 1 ? '' : 's' }} regrew</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <div
        v-for="(d, i) in shown"
        :key="d.id"
        class="xg-pop flex flex-col items-center gap-0.5"
        :style="{ animationDelay: `${i * 60}ms` }"
        :title="`${d.name} +${d.count}`"
      >
        <span class="xg-thumb size-11"><XenoPlantIcon :id="d.id" :size="36" stage="ready" /></span>
        <span class="xg-q text-xs">+{{ formatNumber(d.count) }}</span>
      </div>
      <span v-if="plants.length > shown.length" class="self-center text-xs font-bold text-(--xg-muted)">+{{ plants.length - shown.length }} more</span>
    </div>
    <div class="flex items-center gap-2 ml-auto">
      <XenoButton size="sm" to="/xeno/market" label="Sell surplus" />
      <XenoButton size="sm" square variant="ghost" icon="i-lucide-x" aria-label="Dismiss" @click="$emit('close')" />
    </div>
  </section>
</template>
