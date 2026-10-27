<script setup lang="ts">
import { effectiveGrowTime, getPlant, type Mutation, type PlantType } from '#shared/utils/xeno'
import { formatDuration } from '~/lib/xeno-format'
import { formatPct, roman, tierClass } from '~/lib/xeno-ui'

// One Xenopedia entry: the plant, its numbers, how to breed it and what it breeds into.
const props = defineProps<{
  plant: PlantType
  status: 'known' | 'reach' | 'unknown'
  statusLabel: { text: string, color: string }
  owned: number
  bredFrom: Mutation[]
  breedsInto: (Mutation & { other: string })[]
  discovered: Set<string>
  mutationBoost: number
}>()
defineEmits<{ pick: [id: string] }>()

const shown = computed(() => props.status !== 'unknown')
const name = (id: string) => props.discovered.has(id) ? (getPlant(id)?.name ?? id) : '???'
const facts = computed(() => [
  { l: 'Value', v: formatNumber(props.plant.value) },
  { l: 'Speed', v: String(props.plant.speed) },
  { l: 'Yield', v: `1–${1 + props.plant.yield}` },
  { l: 'Grows', v: formatDuration(effectiveGrowTime(props.plant)) }
])
const yourChance = (m: Mutation) => Math.max(0, Math.min(1, m.chance + props.mutationBoost))
</script>

<template>
  <div class="xg-thumb w-full h-52 !rounded-[22px_22px_22px_6px] shrink-0">
    <span v-if="!shown" class="size-24 rounded-[20px_20px_20px_6px] border-[1.5px] border-dashed border-(--xg-edge2) flex items-center justify-center font-bold text-4xl text-(--xg-faint)">?</span>
    <XenoPlantIcon v-else :id="plant.id" :size="184" stage="ready" :silhouette="status === 'reach'" :animated="status === 'known'" />
  </div>

  <div>
    <p class="xg-label" :style="{ color: statusLabel.color }">{{ statusLabel.text }}</p>
    <h2 class="xg-h text-2xl mt-0.5 flex flex-wrap items-center gap-x-2">
      {{ shown ? plant.name : 'Unknown species' }}
      <span class="xg-tier !text-[15px]" :class="tierClass(plant.tier, !!plant.voidPlant)">{{ roman(plant.tier) }}</span>
    </h2>
    <p v-if="shown" class="text-[13px] text-(--xg-muted) mt-1">{{ plant.description }}</p>
    <p v-if="owned" class="text-[13px] mt-1"><b class="xg-num">{{ formatNumber(owned, false) }}</b> <span class="text-(--xg-muted)">on your shelf</span></p>
    <p v-if="plant.voidPlant && shown" class="text-[12.5px] font-bold text-(--xg-uv) mt-1.5">Void plant: only grows in a planter with a tier II+ artifact.</p>
  </div>

  <div v-if="shown" class="grid grid-cols-4 gap-1.5">
    <div v-for="f in facts" :key="f.l" class="xg-well px-2 py-1.5 min-w-0">
      <span class="block text-[10px] font-extrabold tracking-[.08em] uppercase text-(--xg-faint)">{{ f.l }}</span>
      <b class="xg-num block text-[14px] truncate">{{ f.v }}</b>
    </div>
  </div>

  <div>
    <p class="xg-label">Bred from</p>
    <p v-if="plant.isStarter" class="text-[12.5px] text-(--xg-muted) mt-1.5">A starter plant. Buy its seeds in the Market.</p>
    <p v-else-if="!bredFrom.length" class="text-[12.5px] text-(--xg-muted) mt-1.5">No known recipe.</p>
    <div v-for="m in bredFrom" :key="`${m.parent1}-${m.parent2}`" class="xg-well p-2.5 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <button type="button" class="inline-flex items-center gap-1.5" @click="$emit('pick', m.parent1)">
        <XenoPlantIcon :id="m.parent1" :size="28" stage="ready" :silhouette="!discovered.has(m.parent1)" /><b class="text-[13px]">{{ name(m.parent1) }}</b>
      </button>
      <span class="text-(--xg-faint)">+</span>
      <button type="button" class="inline-flex items-center gap-1.5" @click="$emit('pick', m.parent2)">
        <XenoPlantIcon :id="m.parent2" :size="28" stage="ready" :silhouette="!discovered.has(m.parent2)" /><b class="text-[13px]">{{ name(m.parent2) }}</b>
      </button>
      <span class="flex-1" />
      <span class="xg-num text-xs text-right">
        <span class="text-(--xg-faint)">base</span> <b :class="m.chance > 0 ? '' : 'text-(--xg-rose)'">{{ formatPct(m.chance) }}</b>
        <span class="text-(--xg-faint)"> · you</span> <b :class="yourChance(m) > 0 ? 'text-(--xg-uv)' : 'text-(--xg-rose)'">{{ yourChance(m) > 0 ? formatPct(yourChance(m)) : 'needs a mutation artifact' }}</b>
      </span>
    </div>
  </div>

  <div v-if="breedsInto.length">
    <p class="xg-label">Breeds into</p>
    <div class="flex flex-col gap-1 mt-2">
      <button
        v-for="r in breedsInto"
        :key="`${r.other}-${r.offspring}`"
        type="button"
        class="flex items-center gap-2 text-[12.5px] text-left rounded-lg px-1 py-0.5 hover:bg-(--xg-hover)"
        @click="$emit('pick', r.offspring)"
      >
        <span class="text-(--xg-faint)">with</span><b class="truncate">{{ name(r.other) }}</b><span class="text-(--xg-faint)">→</span>
        <XenoPlantIcon :id="r.offspring" :size="26" stage="ready" :silhouette="!discovered.has(r.offspring)" />
        <b class="truncate" :class="discovered.has(r.offspring) ? '' : 'text-(--xg-uv)'">{{ name(r.offspring) }}</b>
        <span class="ml-auto xg-num text-(--xg-faint)">{{ formatPct(r.chance) }}</span>
      </button>
    </div>
  </div>

  <div class="flex gap-2 mt-auto pt-1">
    <XenoButton
      v-if="!plant.isStarter"
      size="sm"
      class="flex-1"
      :variant="status === 'reach' ? 'go' : 'default'"
      to="/xeno/breeder"
      :label="status === 'known' ? 'Breed more' : 'Breed it'"
    />
    <XenoButton v-if="status === 'known'" size="sm" :class="plant.isStarter ? 'flex-1' : ''" to="/xeno/market?tab=buy" label="Buy seeds" />
  </div>
</template>
