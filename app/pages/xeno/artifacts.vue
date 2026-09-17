<script setup lang="ts">
import { ARTIFACT_TYPES, artifactStatRows, gemCraftCost, getPlant, type ArtifactType } from '#shared/utils/xeno'

const { inventory, buyArtifact } = useXeno()
const { user } = useAuth()
const sound = useXenoSound()
const fx = useXenoFx()

const gems = computed(() => user.value?.gems ?? 0)

const activeTab = ref<'grid' | 'breeder'>('grid')
const gemCraft = ref(false)
const buying = ref<Record<string, boolean>>({})
const flashing = ref<string | null>(null)

const CRAFT_QUANTITIES = [1, 10, 50] as const

interface ArtifactFamily {
  id: string
  name: string
  description: string
  icon: string
  artifacts: ArtifactType[]
}

function family(id: string, name: string, description: string, icon: string, matches: (artifact: ArtifactType) => boolean): ArtifactFamily {
  return { id, name, description, icon, artifacts: ARTIFACT_TYPES.filter(matches).sort((a, b) => a.level - b.level) }
}

const gridFamilies = [
  family('speed-runes', 'Speed Runes', 'Pure grow-time reduction', 'i-lucide-zap', a => a.id.startsWith('speed-rune')),
  family('yield-crystals', 'Yield Crystals', 'Pure harvest yield', 'i-lucide-gem', a => a.id.startsWith('yield-crystal')),
  family('harvest-prisms', 'Harvest Prisms', 'Balanced speed and yield', 'i-lucide-sparkles', a => a.id.startsWith('harvest-prism'))
]

const breederFamilies = [
  family('growth-catalysts', 'Growth Catalysts', 'Litter size and incubation speed', 'i-lucide-sprout', a => a.id.startsWith('growth-catalyst')),
  family('mutation-amplifiers', 'Mutation Amplifiers', 'Mutation chance and incubation speed', 'i-lucide-dna', a => a.id.startsWith('mutation-booster') || a.id.startsWith('prism-lens')),
  family('xenoculture-flasks', 'Xenoculture Flasks', 'All-round pod bonuses', 'i-lucide-flask-conical', a => a.id.startsWith('xenoculture-flask'))
]

const activeFamilies = computed(() => activeTab.value === 'grid' ? gridFamilies : breederFamilies)

// Owned plant counts by type, computed once per inventory change instead of
// filtering the whole inventory for every cost chip on every render.
const ownedByType = computed(() => {
  const m = new Map<string, number>()
  for (const i of inventory.value as any[]) m.set(i.typeId, (m.get(i.typeId) ?? 0) + i.quantity)
  return m
})
function ownedCount(plantTypeId: string): number {
  return ownedByType.value.get(plantTypeId) ?? 0
}

function canAfford(cost: { plantTypeId: string; quantity: number }[], count = 1): boolean {
  return cost.every(c => ownedCount(c.plantTypeId) >= c.quantity * count)
}
function canAffordGems(art: ArtifactType, count = 1): boolean {
  return !gemCraft.value || gems.value >= gemCraftCost(art) * count
}
function maxCraftable(art: ArtifactType): number {
  let max = Math.min(...art.cost.map(c => Math.floor(ownedCount(c.plantTypeId) / c.quantity)))
  if (gemCraft.value) max = Math.min(max, Math.floor(gems.value / gemCraftCost(art)))
  return Number.isFinite(max) ? Math.max(0, max) : 0
}

const craftableCount = computed(() => activeFamilies.value.flatMap(f => f.artifacts).filter(a => maxCraftable(a) > 0).length)

async function doBuy(art: ArtifactType, count: number, e: MouseEvent) {
  const key = `${art.id}-${count}`
  buying.value[key] = true
  try {
    await buyArtifact(art.id, gemCraft.value, count)
    sound.play('craft')
    flashing.value = art.id
    setTimeout(() => { if (flashing.value === art.id) flashing.value = null }, 650)
    fx.burst(e.clientX, e.clientY, { count: 10, spread: 50, color: gemCraft.value ? 'var(--ui-secondary)' : undefined })
    fx.float(e.clientX, e.clientY - 10, count, { emoji: art.emoji, colorClass: 'text-primary' })
  } catch { sound.play('error') } finally { delete buying.value[key] }
}

function setTab(t: 'grid' | 'breeder') {
  if (activeTab.value === t) return
  activeTab.value = t
  sound.play('select')
}
watch(gemCraft, () => sound.play('select'))

const LEVEL_GLOW: Record<number, string> = {
  1: '',
  2: '',
  3: 'border-primary/25',
  4: 'border-primary/40',
  5: 'border-primary/60 shadow-[0_0_30px_-12px_var(--ui-primary)]',
}
</script>

<template>
  <UContainer class="pt-6">
    <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-black tracking-tight">Artifacts</h1>
        <p class="text-xs text-muted mt-0.5">Forge relics from surplus plants. Every artifact burns one charge per use.</p>
      </div>

      <!-- Gem crafting toggle -->
      <label
        class="flex items-center gap-2.5 rounded-2xl border px-3 py-2 shrink-0 transition-all cursor-pointer select-none"
        :class="gemCraft ? 'border-secondary/50 bg-secondary/10 shadow-[0_0_24px_-10px_var(--ui-secondary)]' : 'border-default bg-elevated'"
      >
        <span class="xeno-orb size-8" :class="gemCraft ? 'xeno-orb-gem' : ''">
          <UIcon name="i-lucide-sparkles" class="size-4" :class="gemCraft ? 'text-secondary' : 'text-muted'" />
        </span>
        <div class="leading-tight">
          <p class="text-xs font-semibold">Gem infusion</p>
          <p class="text-[10px] text-muted">+1 level on every effect</p>
        </div>
        <USwitch v-model="gemCraft" color="secondary" />
      </label>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-1 mb-6">
      <button class="xeno-tab" :class="activeTab === 'grid' ? 'xeno-tab-active' : ''" @click="setTab('grid')">
        <UIcon name="i-lucide-layout-grid" class="size-4" /> Garden relics
      </button>
      <button class="xeno-tab" :class="activeTab === 'breeder' ? 'xeno-tab-active' : ''" @click="setTab('breeder')">
        <UIcon name="i-lucide-dna" class="size-4" /> Pod relics
      </button>
      <span class="ml-auto text-xs text-muted"><span class="font-bold text-primary">{{ craftableCount }}</span> craftable now</span>
    </div>

    <!-- Artifact families -->
    <div class="space-y-8 pb-8">
      <section v-for="artifactFamily in activeFamilies" :key="artifactFamily.id">
        <div class="mb-3 flex items-center gap-3">
          <div class="xeno-orb size-9 shrink-0">
            <UIcon :name="artifactFamily.icon" class="size-4 text-primary" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-black leading-tight">{{ artifactFamily.name }}</h2>
            <p class="mt-0.5 text-xs text-muted">{{ artifactFamily.description }}</p>
          </div>
          <div class="h-px flex-1 bg-gradient-to-r from-primary/30 to-transparent" />
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div
            v-for="art in artifactFamily.artifacts"
            :key="art.id"
            class="xeno-panel xeno-lift flex min-w-0 flex-col rounded-2xl relative overflow-hidden"
            :class="[LEVEL_GLOW[art.level], flashing === art.id ? 'xeno-craft-flash' : '', maxCraftable(art) > 0 ? '' : 'opacity-80']"
          >
            <div v-if="art.level === 5" class="absolute -top-10 -right-10 size-32 rounded-full bg-primary/15 blur-2xl pointer-events-none" />

            <!-- Header -->
            <div class="flex items-center gap-2.5 px-3.5 pt-3.5 pb-0 relative">
              <span class="xeno-orb size-10 text-lg shrink-0" :class="gemCraft ? 'xeno-orb-gem' : ''">{{ art.emoji }}</span>
              <div class="flex-1 min-w-0">
                <p class="truncate text-sm font-bold leading-snug" :title="art.name">{{ art.name }}</p>
                <p class="text-[10px] text-muted flex items-center gap-1 mt-0.5">
                  <UIcon name="i-lucide-battery-medium" class="size-3" /> {{ art.maxCharges }} charges
                </p>
              </div>
              <span class="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-black leading-none" :class="art.level >= 4 ? 'bg-primary/15 text-primary' : 'bg-muted/10 text-muted'">T{{ art.level }}</span>
            </div>

            <!-- Stats -->
            <div class="px-3.5 pt-3 pb-2 space-y-1.5 relative">
              <XenoStatLevel
                v-for="row in artifactStatRows(art, gemCraft).filter(r => r.level > 0)"
                :key="row.label" :label="row.label" :level="row.level" :max="row.max" :color="row.color"
              />
            </div>

            <!-- Cost -->
            <div class="px-3.5 pb-2.5 flex-1 relative">
              <p class="xeno-eyebrow mb-1.5">Ingredients</p>
              <div class="flex flex-wrap gap-1">
                <UTooltip
                  v-for="c in art.cost" :key="c.plantTypeId"
                  :disabled="!getPlant(c.plantTypeId)" :delay-duration="300"
                  :content="{ side: 'bottom', align: 'end', sideOffset: 6 }"
                  :ui="{ content: 'h-auto p-0 bg-transparent ring-0 shadow-none' }"
                >
                  <template #content>
                    <XenoPlantTooltipContent v-if="getPlant(c.plantTypeId)" v-bind="getPlant(c.plantTypeId)!" />
                  </template>
                  <div
                    class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md border font-medium cursor-default"
                    :class="ownedCount(c.plantTypeId) >= c.quantity ? 'border-success/30 bg-success/10 text-success' : 'border-default/50 text-muted'"
                  >
                    <XenoPlantIcon :id="c.plantTypeId" :size="20" :class="ownedCount(c.plantTypeId) ? '' : 'xeno-silhouette'" />
                    <span>{{ c.quantity }}×</span>
                    <span class="opacity-60 tabular-nums">({{ ownedCount(c.plantTypeId) }})</span>
                  </div>
                </UTooltip>
                <div
                  v-if="gemCraft"
                  class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md border font-medium"
                  :class="canAffordGems(art) ? 'border-secondary/40 bg-secondary/10 text-secondary' : 'border-error/40 bg-error/10 text-error'"
                >
                  <UIcon name="i-lucide-gem" class="size-3.5" />
                  <span>{{ gemCraftCost(art) }}×</span>
                  <span class="opacity-60 tabular-nums">({{ gems }})</span>
                </div>
              </div>
            </div>

            <!-- Craft -->
            <div class="px-3.5 pb-3.5 relative">
              <p class="xeno-eyebrow mb-1.5">
                {{ gemCraft ? 'Infuse' : 'Forge' }}
                <span class="ml-1 font-medium normal-case tracking-normal" :class="maxCraftable(art) > 0 ? 'text-primary' : 'opacity-70'">max {{ maxCraftable(art) }}</span>
              </p>
              <div class="flex gap-1">
                <UButton
                  v-for="qty in CRAFT_QUANTITIES" :key="qty"
                  :icon="qty === 1 ? (gemCraft ? 'i-lucide-sparkles' : 'i-lucide-hammer') : undefined"
                  size="sm"
                  :color="gemCraft ? 'secondary' : 'primary'"
                  class="flex-1 justify-center"
                  :loading="buying[`${art.id}-${qty}`]"
                  :disabled="!canAfford(art.cost, qty) || !canAffordGems(art, qty)"
                  @click="(e: MouseEvent) => doBuy(art, qty, e)"
                >
                  <span class="tabular-nums font-semibold">{{ qty }}×</span>
                </UButton>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </UContainer>

  <XenoHarvestFloat :items="fx.floats.value" />
  <XenoBurstLayer :particles="fx.particles.value" :flashes="fx.flashes.value" />
</template>
