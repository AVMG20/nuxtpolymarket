<script setup lang="ts">
import { tierNameColor, getPlantDisplay } from '#shared/utils/xeno'

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
const open = defineModel<boolean>('open', { required: true })

const total = computed(() => props.drops.reduce((s, d) => s + d.count, 0))

// Count-up so the big number "rolls in" with the reveal.
const shown = ref(0)
watch(open, (v) => {
  if (!v) return
  shown.value = 0
  const start = performance.now()
  const dur = 700
  const tick = (t: number) => {
    const p = Math.min(1, (t - start) / dur)
    shown.value = Math.round(total.value * (1 - Math.pow(1 - p, 3)))
    if (p < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

function tierOf(id: string) {
  return getPlantDisplay(id)?.tier ?? 1
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-md' }">
    <template #content>
      <div class="xeno-shell relative overflow-hidden rounded-xl">
        <div class="absolute inset-0 xeno-bg pointer-events-none" />
        <div class="relative p-6 text-center">
          <p class="xeno-eyebrow">Harvest report</p>
          <div class="mt-2 flex items-baseline justify-center gap-2">
            <span class="text-5xl font-black text-primary xeno-glow-text tabular-nums">+{{ shown }}</span>
            <span class="text-sm text-muted font-semibold">plants</span>
          </div>
          <p class="text-xs text-muted mt-1">
            from <span class="font-bold text-default">{{ slots }}</span> plot{{ slots === 1 ? '' : 's' }}
            <template v-if="replanted"> · <span class="font-bold text-primary">{{ replanted }}</span> replanted</template>
          </p>

          <div class="xeno-stagger mt-5 grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
            <div
              v-for="d in drops"
              :key="d.id"
              class="flex items-center gap-2 rounded-xl border border-default/60 bg-elevated/60 px-2.5 py-2 text-left"
              :class="d.isHybrid ? 'border-primary/40' : ''"
            >
              <XenoPlantIcon :id="d.id" :size="30" />
              <div class="min-w-0 flex-1">
                <p class="text-xs font-bold truncate" :class="tierNameColor(tierOf(d.id))">{{ d.name }}</p>
                <p class="text-[10px] text-muted">{{ d.isHybrid ? 'vessel regrown' : `T${tierOf(d.id)}` }}</p>
              </div>
              <span class="text-sm font-black text-primary tabular-nums">+{{ d.count }}</span>
            </div>
          </div>

          <UButton class="mt-5" block label="Nice" color="primary" size="lg" @click="open = false" />
        </div>
      </div>
    </template>
  </UModal>
</template>
