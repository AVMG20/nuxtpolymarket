<script setup lang="ts">
import { ARTIFACT_TYPES, getPlant, ARTIFACT_SPEED_PER_LEVEL } from '#shared/utils/xeno'

const { inventory, freeArtifacts, buyArtifact } = useXeno()

const activeTab = ref<'grid' | 'breeder'>('grid')
const buying = ref<Record<string, boolean>>({})

const gridArtifacts = ARTIFACT_TYPES.filter(a => a.effects.some(e => e.type.startsWith('grid_')))
const breederArtifacts = ARTIFACT_TYPES.filter(a => a.effects.some(e => e.type.startsWith('breeder_')))

function ownedCount(plantTypeId: string): number {
  return inventory.value
    .filter((i: any) => i.typeId === plantTypeId)
    .reduce((s: number, i: any) => s + i.quantity, 0)
}

function canAfford(cost: { plantTypeId: string; quantity: number }[]): boolean {
  return cost.every(c => ownedCount(c.plantTypeId) >= c.quantity)
}

async function doBuy(typeId: string) {
  buying.value[typeId] = true
  try { await buyArtifact(typeId) } finally { delete buying.value[typeId] }
}

const MUTATION_PER_LEVEL = 0.05

function toSpeedLevel(pct: number) { return Math.round(Math.round(pct * 1000) / Math.round(ARTIFACT_SPEED_PER_LEVEL * 1000)) }
function toMutLevel(pct: number) { return Math.ceil(Math.round(pct * 1000) / Math.round(MUTATION_PER_LEVEL * 1000)) }

const MAX_CHARGES       = Math.max(...ARTIFACT_TYPES.map(a => a.maxCharges))
const MAX_SPEED_LVL     = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'grid_speed_boost').map(e => toSpeedLevel(e.value))), 1)
const MAX_YIELD_LVL     = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'grid_yield_bonus').map(e => e.value)), 1)
const MAX_EXTRA_LVL     = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'breeder_extra_yield').map(e => e.value)), 1)
const MAX_MUT_LVL       = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'breeder_mutation_boost').map(e => toMutLevel(e.value))), 1)
const MAX_B_SPEED_LVL   = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'breeder_speed_boost').map(e => toSpeedLevel(e.value))), 1)

function specRows(art: typeof ARTIFACT_TYPES[0]) {
  const speedE  = art.effects.find(e => e.type === 'grid_speed_boost')
  const yieldE  = art.effects.find(e => e.type === 'grid_yield_bonus')
  const extraE  = art.effects.find(e => e.type === 'breeder_extra_yield')
  const mutE    = art.effects.find(e => e.type === 'breeder_mutation_boost')
  const bSpeedE = art.effects.find(e => e.type === 'breeder_speed_boost')

  if (art.effects.some(e => e.type.startsWith('grid_'))) {
    return [
      { label: 'Speed', lvl: speedE ? toSpeedLevel(speedE.value) : 0, max: MAX_SPEED_LVL, color: 'bg-warning' },
      { label: 'Yield', lvl: yieldE ? yieldE.value : 0,               max: MAX_YIELD_LVL, color: 'bg-info' },
    ]
  }
  return [
    { label: 'Speed',    lvl: bSpeedE ? toSpeedLevel(bSpeedE.value) : 0, max: MAX_B_SPEED_LVL, color: 'bg-warning' },
    { label: 'Yield',    lvl: extraE  ? extraE.value : 0,                 max: MAX_EXTRA_LVL,   color: 'bg-info' },
    { label: 'Mutation', lvl: mutE    ? toMutLevel(mutE.value) : 0,       max: MAX_MUT_LVL,     color: 'bg-secondary' },
  ]
}
</script>

<template>
  <UContainer class="pt-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-gem" class="text-primary" /> Artifacts
      </h1>
      <p class="text-sm text-muted mt-0.5">Craft powerful artifacts using plants. Each artifact degrades after use.</p>
    </div>

    <!-- Tabs -->
    <div class="flex border-b border-default mb-6">
      <button
        class="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all"
        :class="activeTab === 'grid' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
        @click="activeTab = 'grid'"
      >
        <UIcon name="i-lucide-layout-grid" class="size-4" />
        Grid
      </button>
      <button
        class="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all"
        :class="activeTab === 'breeder' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
        @click="activeTab = 'breeder'"
      >
        <UIcon name="i-lucide-dna" class="size-4" />
        Breeder
      </button>
    </div>

    <!-- Cards -->
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      <div
        v-for="art in activeTab === 'grid' ? gridArtifacts : breederArtifacts"
        :key="art.id"
        class="rounded-xl border border-default bg-elevated flex flex-col"
      >
        <!-- Header -->
        <div class="flex items-center gap-2.5 px-3.5 pt-3.5 pb-0">
          <span class="text-lg leading-none shrink-0">{{ art.emoji }}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <p class="font-semibold text-sm leading-snug">{{ art.name }}</p>
              <span
                v-if="art.effects.filter(e => e.type.startsWith(activeTab + '_')).length > 1"
                class="text-[10px] font-bold px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 leading-none"
              >Hybrid</span>
            </div>
          </div>
          <span class="text-xs font-bold text-muted tabular-nums shrink-0">×{{ art.maxCharges }}</span>
        </div>

        <!-- Stats (only non-zero) -->
        <div class="px-3.5 pt-2.5 pb-2 space-y-1.5">
          <XenoStatLevel
            v-for="row in specRows(art).filter(r => r.lvl > 0)"
            :key="row.label"
            :label="row.label"
            :level="row.lvl"
            :max="row.max"
            :color="row.color"
          />
        </div>

        <!-- Cost -->
        <div class="px-3.5 pb-2.5 flex-1">
          <p class="text-[10px] font-bold uppercase tracking-widest text-muted mb-1.5">Cost</p>
          <div class="flex flex-wrap gap-1">
            <div
              v-for="c in art.cost"
              :key="c.plantTypeId"
              class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium"
              :class="ownedCount(c.plantTypeId) >= c.quantity
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-default/50 text-muted'"
            >
              <XenoPlantIcon :id="c.plantTypeId" :size="16" />
              <span>{{ c.quantity }}×</span>
              <span class="opacity-60">({{ ownedCount(c.plantTypeId) }})</span>
            </div>
          </div>
        </div>

        <!-- Craft -->
        <div class="px-3.5 pb-3.5">
          <UButton
            label="Craft"
            icon="i-lucide-hammer"
            size="sm"
            :loading="buying[art.id]"
            :disabled="!canAfford(art.cost)"
            block
            @click="doBuy(art.id)"
          />
        </div>
      </div>
    </div>

  </UContainer>
</template>
