<script setup lang="ts">
import { DialogDescription, DialogTitle } from 'reka-ui'
import { getPlant, PLANT_TYPES } from '#shared/utils/xeno'
import { roman, tierClass } from '~/lib/xeno-ui'

// The collect reveal for a mutation: petals open behind the new plant.
export interface BreedResult {
  typeId: string
  quantity: number
  speed: number
  yield: number
  isNew: boolean
  discovered: number
}

const props = defineProps<{ result: BreedResult | null }>()
const open = defineModel<boolean>('open', { required: true })

const plant = computed(() => props.result ? getPlant(props.result.typeId) : undefined)
const PETALS = [0, 45, 90, 135, 180, 225, 270, 315]
</script>

<template>
  <UModal
    v-model:open="open"
    :title="plant ? `Mutation: ${plant.name}` : 'Mutation'"
    :ui="{ content: 'xeno max-w-md bg-(--xg-surface) ring-1 ring-(--xg-uv-edge) rounded-[24px_24px_24px_8px] overflow-hidden' }"
  >
    <template #content>
      <div v-if="result && plant" class="relative px-6 pt-7 pb-6 text-center text-(--xg-ink)">
        <span class="xg-petals" style="top: 160px" aria-hidden="true">
          <i v-for="r in PETALS" :key="r" :style="{ transform: `rotate(${r}deg)` }" />
        </span>
        <p class="xg-label relative !text-(--xg-uv)">Mutation</p>
        <div class="relative mx-auto mt-2 mb-1 size-48 flex items-center justify-center xg-pop">
          <XenoPlantIcon :id="result.typeId" :size="180" stage="ready" animated />
        </div>
        <DialogTitle as-child>
          <h2 class="relative xg-h text-3xl">
            {{ plant.name }}
            <span class="xg-tier text-base align-middle" :class="tierClass(plant.tier, !!plant.voidPlant)">{{ roman(plant.tier) }}</span>
          </h2>
        </DialogTitle>
        <DialogDescription as-child>
          <p class="relative xg-stats mt-2 text-[13.5px]">×<b>{{ result.quantity }}</b> · Speed <b>{{ result.speed }}</b> · Yield <b>{{ result.yield }}</b> · {{ formatNumber(plant.value) }} each</p>
        </DialogDescription>
        <p v-if="result.isNew" class="relative mt-2.5 text-[13px]">
          <b class="text-(--xg-uv)">New in your Xenopedia</b>
          <span class="text-(--xg-muted)"> · {{ result.discovered }} of {{ PLANT_TYPES.length }} discovered</span>
        </p>
        <div class="relative mt-5 flex flex-wrap justify-center gap-2">
          <XenoButton size="sm" label="Breed again" @click="open = false" />
          <XenoButton size="sm" to="/xeno" label="Plant it" />
          <XenoButton size="sm" variant="uv" :to="`/xeno/encyclopedia?species=${result.typeId}`" label="Open entry" />
        </div>
      </div>
    </template>
  </UModal>
</template>
