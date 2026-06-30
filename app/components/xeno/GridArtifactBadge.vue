<script setup lang="ts">
import { getArtifact, getEffectValueFor } from '#shared/utils/xeno'

const props = defineProps<{ slot: any }>()

const art = computed(() => props.slot?.artifact ? getArtifact(props.slot.artifact.typeId) : undefined)
const gemCrafted = computed(() => props.slot?.artifact?.gemCrafted ?? false)

const ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }
const level = computed(() => ROMAN[art.value?.level ?? 1] ?? String(art.value?.level ?? 1))

const speedDots = computed(() => {
  if (!art.value) return 0
  return Math.round(getEffectValueFor(art.value, 'grid_speed_boost', gemCrafted.value) * 20)
})

const yieldDots = computed(() => {
  if (!art.value) return 0
  return getEffectValueFor(art.value, 'grid_yield_bonus', gemCrafted.value)
})
</script>

<template>
  <div v-if="slot?.artifact" class="absolute top-1.5 left-1.5 flex flex-col items-start gap-1 z-10">
    <div
      class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 mb-1"
      :class="gemCrafted ? 'bg-primary/20 ring-1 ring-primary/40' : 'bg-muted'"
    >
      <span class="text-xs leading-none">{{ art?.emoji }}</span>
      <UIcon v-if="gemCrafted" name="i-lucide-sparkles" class="size-2.5 text-primary" />
      <span class="text-xs font-bold text-neutral-400 leading-none pr-1.5">{{ level }}</span>
      <span class="text-xs font-bold text-neutral-400">{{ slot.artifact.chargesRemaining }}*</span>
    </div>
    <div class="flex gap-1 pl-1">
      <div v-if="speedDots > 0" class="flex flex-col gap-[2px]">
        <div v-for="i in speedDots" :key="`s${i}`" class="size-1 rounded-full bg-yellow-400" />
      </div>
      <div v-if="yieldDots > 0" class="flex flex-col gap-[2px]">
        <div v-for="i in yieldDots" :key="`y${i}`" class="size-1 rounded-full bg-blue-400" />
      </div>
    </div>
  </div>
</template>
