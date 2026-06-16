<script setup lang="ts">
import { ARTIFACT_TYPES, getPlant, SPEED_REDUCTION_PER_LEVEL } from '#shared/utils/xeno'

const { inventory, freeArtifacts, buyArtifact } = useXeno()

const activeTab = ref<'grid' | 'breeder'>('grid')
const buying = ref<Record<string, boolean>>({})

const gridArtifacts = ARTIFACT_TYPES.filter(a => a.effect.type.startsWith('grid_'))
const breederArtifacts = ARTIFACT_TYPES.filter(a => a.effect.type.startsWith('breeder_'))

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

// 1 speed level = 10% grow time reduction (SPEED_REDUCTION_PER_LEVEL = 0.10)
// Multiply before dividing to avoid floating-point errors (0.35/0.10 = 3.4999...)
const MUTATION_PER_LEVEL = 0.05

function toSpeedLevel(pct: number) { return Math.round(Math.round(pct * 1000) / Math.round(SPEED_REDUCTION_PER_LEVEL * 1000)) }
function toMutLevel(pct: number) { return Math.ceil(Math.round(pct * 1000) / Math.round(MUTATION_PER_LEVEL * 1000)) }

const MAX_CHARGES = Math.max(...ARTIFACT_TYPES.map(a => a.maxCharges))

// Computed caps from actual artifact data so they stay in sync automatically
const MAX_SPEED_LVL = Math.max(...ARTIFACT_TYPES.filter(a => a.effect.type === 'grid_speed_boost').map(a => toSpeedLevel(a.effect.value)))
const MAX_YIELD_LVL = Math.max(...ARTIFACT_TYPES.filter(a => a.effect.type === 'grid_yield_bonus').map(a => a.effect.value))
const MAX_EXTRA_LVL = Math.max(...ARTIFACT_TYPES.filter(a => a.effect.type === 'breeder_extra_yield').map(a => a.effect.value))
const MAX_MUT_LVL   = Math.max(...ARTIFACT_TYPES.filter(a => a.effect.type === 'breeder_mutation_boost').map(a => toMutLevel(a.effect.value)))

function specRows(art: typeof ARTIFACT_TYPES[0]) {
  const e = art.effect
  if (e.type.startsWith('grid_')) {
    return [
      { label: 'Speed', lvl: e.type === 'grid_speed_boost' ? toSpeedLevel(e.value) : 0, max: MAX_SPEED_LVL, color: 'bg-warning' },
      { label: 'Yield', lvl: e.type === 'grid_yield_bonus' ? e.value : 0, max: MAX_YIELD_LVL, color: 'bg-info' },
    ]
  }
  return [
    { label: 'Extra yield', lvl: e.type === 'breeder_extra_yield' ? e.value : 0, max: MAX_EXTRA_LVL, color: 'bg-info' },
    { label: 'Mutation', lvl: e.type === 'breeder_mutation_boost' ? toMutLevel(e.value) : 0, max: MAX_MUT_LVL, color: 'bg-secondary' },
  ]
}
</script>

<template>
  <UContainer>
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
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="art in activeTab === 'grid' ? gridArtifacts : breederArtifacts"
        :key="art.id"
        class="rounded-xl border border-default bg-elevated flex flex-col"
      >
        <!-- Header -->
        <div class="flex items-start justify-between p-4 pb-3">
          <div class="flex items-center gap-3">
            <span class="text-2xl leading-none">{{ art.emoji }}</span>
            <div>
              <p class="font-semibold">{{ art.name }}</p>
              <p class="text-xs text-muted mt-0.5">{{ art.maxCharges }} charges each</p>
            </div>
          </div>
        </div>

        <!-- Spec table -->
        <div class="mx-4 mb-4 rounded-lg bg-background/50 border border-default/40 divide-y divide-default/30">
          <div v-for="row in specRows(art)" :key="row.label" class="px-3 py-2.5">
            <XenoStatLevel :label="row.label" :level="row.lvl" :max="row.max" :color="row.color" />
          </div>
          <div class="px-3 py-2.5">
            <XenoStatLevel label="Charges" :level="art.maxCharges" :max="MAX_CHARGES" color="bg-primary" />
          </div>
        </div>

        <!-- Cost -->
        <div class="px-4 pb-3 flex-1">
          <p class="text-xs font-bold uppercase tracking-wider text-muted mb-2">Cost</p>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="c in art.cost"
              :key="c.plantTypeId"
              class="flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-lg border font-medium transition-colors"
              :class="ownedCount(c.plantTypeId) >= c.quantity
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-default bg-elevated/60 text-default'"
            >
              <span>{{ getPlant(c.plantTypeId)?.emoji }}</span>
              <span>{{ c.quantity }}× {{ getPlant(c.plantTypeId)?.name }}</span>
              <span class="text-muted text-xs">({{ ownedCount(c.plantTypeId) }})</span>
            </div>
          </div>
        </div>

        <!-- Craft -->
        <div class="px-4 pb-4">
          <UButton
            label="Craft"
            icon="i-lucide-hammer"
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
