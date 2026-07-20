<script setup lang="ts">
import { ARTIFACT_TYPES, artifactStatRows, gemCraftCost, getPlant, type ArtifactType } from '#shared/utils/xeno'

const { inventory, buyArtifact } = useXeno()
const { user } = useAuth()

const gems = computed(() => user.value?.gems ?? 0)

const activeTab = ref<'grid' | 'breeder'>('grid')
const gemCraft = ref(false)
const buying = ref<Record<string, boolean>>({})

interface ArtifactFamily {
  id: string
  name: string
  description: string
  icon: string
  artifacts: ArtifactType[]
}

function family(
  id: string,
  name: string,
  description: string,
  icon: string,
  matches: (artifact: ArtifactType) => boolean
): ArtifactFamily {
  return {
    id,
    name,
    description,
    icon,
    artifacts: ARTIFACT_TYPES.filter(matches).sort((a, b) => a.level - b.level)
  }
}

const gridFamilies = [
  family('speed-runes', 'Speed Runes', 'Pure grow-time reduction', 'i-lucide-zap', a => a.id.startsWith('speed-rune')),
  family('yield-crystals', 'Yield Crystals', 'Pure harvest yield', 'i-lucide-gem', a => a.id.startsWith('yield-crystal')),
  family('harvest-prisms', 'Harvest Prisms', 'Balanced speed and yield', 'i-lucide-sparkles', a => a.id.startsWith('harvest-prism'))
]

const breederFamilies = [
  family('growth-catalysts', 'Growth Catalysts', 'Yield and breeding speed', 'i-lucide-sprout', a => a.id.startsWith('growth-catalyst')),
  family('mutation-amplifiers', 'Mutation Amplifiers', 'Mutation chance and breeding speed', 'i-lucide-dna', a => a.id.startsWith('mutation-booster') || a.id.startsWith('prism-lens')),
  family('xenoculture-flasks', 'Xenoculture Flasks', 'All-round breeder bonuses', 'i-lucide-flask-conical', a => a.id.startsWith('xenoculture-flask'))
]

const activeFamilies = computed(() => activeTab.value === 'grid' ? gridFamilies : breederFamilies)

function ownedCount(plantTypeId: string): number {
  return inventory.value
    .filter((i: any) => i.typeId === plantTypeId)
    .reduce((s: number, i: any) => s + i.quantity, 0)
}

function canAfford(cost: { plantTypeId: string; quantity: number }[]): boolean {
  return cost.every(c => ownedCount(c.plantTypeId) >= c.quantity)
}

function canAffordGems(art: typeof ARTIFACT_TYPES[0]): boolean {
  return !gemCraft.value || gems.value >= gemCraftCost(art)
}

async function doBuy(art: typeof ARTIFACT_TYPES[0]) {
  buying.value[art.id] = true
  try { await buyArtifact(art.id, gemCraft.value) } finally { delete buying.value[art.id] }
}
</script>

<template>
  <UContainer class="pt-6">
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold flex items-center gap-2">
          <UIcon name="i-lucide-gem" class="text-primary" /> Artifacts
        </h1>
        <p class="text-sm text-muted mt-0.5">Craft powerful artifacts using plants. Each artifact degrades after use.</p>
      </div>

      <!-- Gem crafting toggle -->
      <div
        class="flex items-center gap-2.5 rounded-xl border px-3 py-2 shrink-0 transition-colors"
        :class="gemCraft ? 'border-primary/40 bg-primary/5' : 'border-default bg-elevated'"
      >
        <UIcon name="i-lucide-sparkles" class="size-4" :class="gemCraft ? 'text-primary' : 'text-muted'" />
        <div class="leading-tight">
          <p class="text-xs font-semibold">Gem Crafting</p>
          <p class="text-[10px] text-muted">+1 to all levels</p>
        </div>
        <USwitch v-model="gemCraft" />
      </div>
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

    <!-- Artifact families -->
    <div class="space-y-8 pb-8">
      <section v-for="artifactFamily in activeFamilies" :key="artifactFamily.id">
        <div class="mb-3 flex items-center gap-3">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon :name="artifactFamily.icon" class="size-4" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold leading-tight">{{ artifactFamily.name }}</h2>
            <p class="mt-0.5 text-xs text-muted">{{ artifactFamily.description }}</p>
          </div>
          <div class="h-px flex-1 bg-default" />
          <span class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted">
            {{ artifactFamily.artifacts.length }} tiers
          </span>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div
            v-for="art in artifactFamily.artifacts"
            :key="art.id"
            class="flex min-w-0 flex-col rounded-xl border bg-elevated"
            :class="art.level === 5 ? 'border-primary/30' : 'border-default'"
          >
            <!-- Header -->
            <div class="flex items-center gap-2.5 px-3.5 pt-3.5 pb-0">
              <span class="text-lg leading-none shrink-0">{{ art.emoji }}</span>
              <div class="flex-1 min-w-0">
                <p class="truncate text-sm font-semibold leading-snug" :title="art.name">{{ art.name }}</p>
              </div>
              <span
                class="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-bold leading-none"
                :class="art.level === 5 ? 'bg-primary/15 text-primary' : 'bg-muted/10 text-muted'"
              >T{{ art.level }}</span>
            </div>

            <div class="mx-3.5 mt-2 flex items-center gap-1 text-[10px] text-muted">
              <UIcon name="i-lucide-battery-medium" class="size-3" />
              <span>{{ art.maxCharges }} uses</span>
            </div>

            <!-- Stats (only non-zero) -->
            <div class="px-3.5 pt-2.5 pb-2 space-y-1.5">
              <XenoStatLevel
                v-for="row in artifactStatRows(art, gemCraft).filter(r => r.level > 0)"
                :key="row.label"
                :label="row.label"
                :level="row.level"
                :max="row.max"
                :color="row.color"
              />
            </div>

            <!-- Cost -->
            <div class="px-3.5 pb-2.5 flex-1">
              <p class="text-[10px] font-bold uppercase tracking-widest text-muted mb-1.5">Cost</p>
              <div class="flex flex-wrap gap-1">
                <UTooltip
                  v-for="c in art.cost"
                  :key="c.plantTypeId"
                  :disabled="!getPlant(c.plantTypeId)"
                  :delay-duration="300"
                  :content="{ side: 'bottom', align: 'end', sideOffset: 6 }"
                  :ui="{ content: 'h-auto p-0 bg-transparent ring-0 shadow-none' }"
                >
                  <template #content>
                    <XenoPlantTooltipContent v-if="getPlant(c.plantTypeId)" v-bind="getPlant(c.plantTypeId)!" />
                  </template>
                  <div
                    class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium cursor-default"
                    :class="ownedCount(c.plantTypeId) >= c.quantity
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-default/50 text-muted'"
                  >
                    <XenoPlantIcon :id="c.plantTypeId" :size="20" />
                    <span>{{ c.quantity }}×</span>
                    <span class="opacity-60">({{ ownedCount(c.plantTypeId) }})</span>
                  </div>
                </UTooltip>
                <!-- Gem cost when gem crafting -->
                <div
                  v-if="gemCraft"
                  class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium"
                  :class="canAffordGems(art)
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-error/40 bg-error/10 text-error'"
                >
                  <UIcon name="i-lucide-gem" class="size-3.5" />
                  <span>{{ gemCraftCost(art) }}×</span>
                  <span class="opacity-60">({{ gems }})</span>
                </div>
              </div>
            </div>

            <!-- Craft -->
            <div class="px-3.5 pb-3.5">
              <UButton
                :label="gemCraft ? 'Gem Craft' : 'Craft'"
                :icon="gemCraft ? 'i-lucide-sparkles' : 'i-lucide-hammer'"
                size="sm"
                :loading="buying[art.id]"
                :disabled="!canAfford(art.cost) || !canAffordGems(art)"
                block
                @click="doBuy(art)"
              />
            </div>
          </div>
        </div>
      </section>
    </div>

  </UContainer>
</template>
