<script setup lang="ts">
import {
  PLANT_TYPES, MUTATIONS, MUTATION_OFFSPRING,
  tierLabel, tierColor, tierBg, tierNameColor, levelTextColor,
} from '#shared/utils/xeno'
import { formatDuration } from '~/lib/xeno-format'

const mutationOffspring = MUTATION_OFFSPRING
const { unlockedTypeIds, inventory } = useXeno()
const { virtualEl: cursorEl, track: trackCursor } = useTooltipCursor()
const sound = useXenoSound()

// A plant type is "discovered" once it has ever been unlocked — permanent.
const discoveredIds = computed(() => new Set(unlockedTypeIds.value))

const ownedByType = computed(() => {
  const m = new Map<string, number>()
  for (const i of inventory.value as any[]) m.set(i.typeId, (m.get(i.typeId) ?? 0) + i.quantity)
  return m
})

const TIER_LABELS: Record<number, string> = {
  1: 'Starter', 2: 'Developed', 3: 'Advanced', 4: 'Elite', 5: 'Cosmic',
  6: 'Ethereal', 7: 'Singularity', 8: 'Transcendent', 9: 'Omega',
}

// ── Filters ──────────────────────────────────────────────────────────────────
type Filter = 'all' | 'discovered' | 'undiscovered' | 'next'
const filter = ref<Filter>('all')
const search = ref('')
const filters: { id: Filter; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: 'i-lucide-layers' },
  { id: 'discovered', label: 'Discovered', icon: 'i-lucide-check' },
  { id: 'undiscovered', label: 'Undiscovered', icon: 'i-lucide-lock' },
  { id: 'next', label: 'Within reach', icon: 'i-lucide-target' },
]
function setFilter(f: Filter) {
  if (filter.value === f) return
  filter.value = f
  sound.play('select')
}

/** Undiscovered species whose every recipe parent has been discovered. */
const withinReach = computed(() => {
  const d = discoveredIds.value
  return new Set(
    PLANT_TYPES
      .filter(p => !d.has(p.id))
      .filter(p => MUTATIONS.some(m => m.offspring === p.id && d.has(m.parent1) && d.has(m.parent2)))
      .map(p => p.id),
  )
})

function matches(p: { id: string; name: string }): boolean {
  const q = search.value.trim().toLowerCase()
  if (q && !p.name.toLowerCase().includes(q)) return false
  const d = discoveredIds.value.has(p.id)
  if (filter.value === 'discovered') return d
  if (filter.value === 'undiscovered') return !d
  if (filter.value === 'next') return withinReach.value.has(p.id)
  return true
}

const tiers = computed(() => [...new Set(PLANT_TYPES.map(plant => plant.tier))].sort((a, b) => a - b)
  .map(t => ({
    tier: t,
    label: TIER_LABELS[t],
    all: PLANT_TYPES.filter(p => p.tier === t),
    plants: PLANT_TYPES.filter(p => p.tier === t && matches(p)),
  }))
  .filter(t => t.plants.length > 0))

const totalPlants = PLANT_TYPES.length
const discoveredCount = computed(() => PLANT_TYPES.filter(p => discoveredIds.value.has(p.id)).length)
const discoveredPct = computed(() => Math.round((discoveredCount.value / totalPlants) * 100))

function parentsOf(plantId: string) {
  return MUTATIONS.filter(m => m.offspring === plantId)
}
function tierMutations(tier: number) {
  const tierPlantIds = new Set(PLANT_TYPES.filter(p => p.tier === tier).map(p => p.id))
  return MUTATIONS.filter(m => tierPlantIds.has(m.offspring))
}
</script>

<template>
  <UContainer class="pt-6">
    <!-- Header -->
    <div class="xeno-panel xeno-panel-accent rounded-3xl p-5 mb-6 flex flex-wrap items-center gap-5">
      <div class="relative size-24 shrink-0">
        <XenoProgressRing :pct="discoveredPct" :size="96" :stroke="6" :ready="discoveredPct >= 100" />
        <div class="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span class="text-xl font-black tabular-nums">{{ discoveredPct }}<span class="text-xs">%</span></span>
          <span class="text-[9px] uppercase tracking-widest text-muted mt-0.5">found</span>
        </div>
      </div>
      <div class="flex-1 min-w-48">
        <p class="xeno-eyebrow">Field guide</p>
        <h1 class="text-2xl font-black tracking-tight">Xenopedia</h1>
        <p class="text-sm text-muted mt-0.5">
          <span class="font-bold text-primary">{{ discoveredCount }}</span> of {{ totalPlants }} species catalogued.
          <template v-if="withinReach.size"> <span class="font-bold text-default">{{ withinReach.size }}</span> more are within reach of your current parents.</template>
        </p>
      </div>
      <div class="flex flex-col gap-2 w-full sm:w-auto">
        <UInput v-model="search" placeholder="Search species…" icon="i-lucide-search" size="sm" class="sm:w-56" />
        <div class="flex flex-wrap gap-1">
          <button v-for="f in filters" :key="f.id" class="xeno-tab !py-1 !px-2.5 !text-xs" :class="filter === f.id ? 'xeno-tab-active' : ''" @click="setFilter(f.id)">
            <UIcon :name="f.icon" class="size-3.5" /> {{ f.label }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="!tiers.length" class="xeno-panel rounded-2xl text-sm text-muted py-12 text-center">No species match.</div>

    <!-- Tier sections -->
    <div class="space-y-10">
      <section v-for="{ tier, label, plants, all } in tiers" :key="tier">
        <div class="flex items-center gap-3 mb-4">
          <span class="text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border" :class="[tierBg(tier), tierColor(tier)]">Tier {{ tier }}</span>
          <p class="text-sm font-black" :class="tierColor(tier)">{{ label }}</p>
          <div class="flex-1 h-px bg-gradient-to-r from-current to-transparent opacity-20" :class="tierColor(tier)" />
          <div class="flex items-center gap-1.5 text-xs text-muted">
            <span class="tabular-nums">{{ all.filter(p => discoveredIds.has(p.id)).length }}/{{ all.length }}</span>
            <div class="w-16 h-1 rounded-full bg-white/10 overflow-hidden">
              <div class="h-full bg-primary" :style="{ width: `${(all.filter(p => discoveredIds.has(p.id)).length / all.length) * 100}%` }" />
            </div>
          </div>
        </div>

        <!-- Mutation recipes -->
        <div v-if="tierMutations(tier).length && filter === 'all' && !search" class="mb-4">
          <p class="xeno-eyebrow mb-2">Mutation recipes</p>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="m in tierMutations(tier)"
              :key="`${m.parent1}-${m.parent2}-${m.offspring}`"
              class="xeno-panel rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs transition-opacity"
              :class="discoveredIds.has(m.offspring) ? '' : withinReach.has(m.offspring) ? 'border-primary/40' : 'opacity-50'"
              :title="`${m.parent1} + ${m.parent2} → ${m.offspring}`"
            >
              <XenoPlantIcon :id="m.parent1" :size="18" :class="discoveredIds.has(m.parent1) ? '' : 'xeno-silhouette'" />
              <span class="text-muted">+</span>
              <XenoPlantIcon :id="m.parent2" :size="18" :class="discoveredIds.has(m.parent2) ? '' : 'xeno-silhouette'" />
              <span class="text-muted">→</span>
              <XenoPlantIcon :id="m.offspring" :size="18" :class="discoveredIds.has(m.offspring) ? '' : 'xeno-silhouette'" />
              <span class="font-semibold" :class="m.chance > 0 ? 'text-muted' : 'text-error/80'">{{ (m.chance * 100).toFixed(0) }}%</span>
              <UIcon v-if="withinReach.has(m.offspring)" name="i-lucide-target" class="size-3 text-primary" title="Both parents discovered" />
            </div>
          </div>
        </div>

        <!-- Plant cards grid -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <UTooltip
            v-for="plant in plants" :key="plant.id"
            :delay-duration="200" :reference="cursorEl" :content="{ side: 'bottom', sideOffset: 12 }"
          >
            <template #content>
              <div class="w-64 p-3 space-y-3 bg-elevated border border-default rounded-xl shadow-xl">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <XenoPlantIcon :id="plant.id" :size="28" :class="discoveredIds.has(plant.id) ? '' : 'xeno-silhouette'" />
                    <div>
                      <p class="font-bold text-sm" :class="discoveredIds.has(plant.id) ? '' : 'text-default/50'">{{ plant.name }}</p>
                      <span class="text-xs font-bold uppercase tracking-wider" :class="discoveredIds.has(plant.id) ? tierColor(plant.tier) : 'text-muted/40'">
                        {{ tierLabel(plant.tier) }}
                        <span v-if="plant.voidPlant"> · Void</span>
                        <span v-else-if="mutationOffspring.has(plant.id)"> · Mutation</span>
                        <span v-else-if="plant.isStarter"> · Starter</span>
                      </span>
                    </div>
                  </div>
                  <UIcon v-if="!discoveredIds.has(plant.id)" name="i-lucide-lock" class="size-4 text-muted/40 shrink-0 mt-0.5" />
                  <span v-else-if="ownedByType.get(plant.id)" class="text-xs font-black text-primary tabular-nums">×{{ ownedByType.get(plant.id) }}</span>
                </div>

                <USeparator />
                <div class="space-y-1.5" :class="discoveredIds.has(plant.id) ? '' : 'opacity-40'">
                  <XenoStatLevel label="Speed" :level="plant.speed" color="bg-warning" />
                  <XenoStatLevel label="Yield" :level="plant.yield" color="bg-info" />
                </div>

                <USeparator />
                <div class="space-y-1" :class="discoveredIds.has(plant.id) ? '' : 'opacity-40'">
                  <div class="flex justify-between text-xs"><span class="text-muted uppercase tracking-wider font-semibold">Growth</span><span class="font-mono">{{ formatDuration(plant.baseTime) }}</span></div>
                  <div class="flex justify-between text-xs"><span class="text-muted uppercase tracking-wider font-semibold">Incubation</span><span class="font-mono">{{ formatDuration(plant.baseTime * 2) }}</span></div>
                  <div class="flex justify-between text-xs"><span class="text-muted uppercase tracking-wider font-semibold">Yield</span><span class="font-mono">1–{{ 1 + plant.yield }}</span></div>
                  <div class="flex justify-between text-xs"><span class="text-muted uppercase tracking-wider font-semibold">Value</span><CoinBalance :value="plant.value" /></div>
                </div>

                <USeparator />
                <div>
                  <p class="text-xs font-bold uppercase tracking-wider text-muted mb-1.5">{{ discoveredIds.has(plant.id) ? 'How to get' : 'How to unlock' }}</p>
                  <p v-if="plant.isStarter" class="text-xs text-muted">Starter plant — available from the beginning.</p>
                  <div v-else-if="parentsOf(plant.id).length" class="space-y-1">
                    <div v-for="m in parentsOf(plant.id)" :key="`${m.parent1}-${m.parent2}`" class="text-xs text-muted flex items-center gap-1">
                      <XenoPlantIcon :id="m.parent1" :size="16" :class="discoveredIds.has(m.parent1) ? '' : 'xeno-silhouette'" />
                      <span>+</span>
                      <XenoPlantIcon :id="m.parent2" :size="16" :class="discoveredIds.has(m.parent2) ? '' : 'xeno-silhouette'" />
                      <span class="text-muted/60">→</span>
                      <span class="font-semibold" :class="m.chance > 0 ? 'text-default' : 'text-error'">{{ (m.chance * 100).toFixed(1) }}%</span>
                      <span v-if="m.chance <= 0" class="text-[10px] text-error/80">needs mutation artifact</span>
                    </div>
                  </div>
                  <p v-else class="text-xs text-muted">No known recipe.</p>
                  <p v-if="plant.voidPlant" class="text-xs text-secondary mt-1.5 font-semibold">🌑 Void plant — needs a tier II+ artifact in its plot to grow.</p>
                </div>

                <p v-if="plant.description" class="text-xs italic" :class="discoveredIds.has(plant.id) ? 'text-muted/70' : 'text-muted/40'">{{ plant.description }}</p>
              </div>
            </template>

            <!-- Card -->
            <div
              class="xeno-lift rounded-2xl border aspect-square flex flex-col overflow-hidden cursor-default relative"
              :class="discoveredIds.has(plant.id) ? tierBg(plant.tier) : withinReach.has(plant.id) ? 'bg-elevated/30 border-primary/30 border-dashed' : 'bg-elevated/20 border-default/50'"
              @mousemove.passive="trackCursor"
            >
              <div class="flex items-center justify-between px-2 pt-2 shrink-0">
                <XenoTierLabel :tier="plant.tier" :class="!discoveredIds.has(plant.id) && 'opacity-30'" />
                <span v-if="plant.voidPlant && discoveredIds.has(plant.id)" class="text-xs leading-none" title="Void plant">🌑</span>
                <span v-else-if="mutationOffspring.has(plant.id) && discoveredIds.has(plant.id)" class="text-xs leading-none" title="Mutation">✨</span>
                <UIcon v-else-if="withinReach.has(plant.id)" name="i-lucide-target" class="size-3.5 text-primary" title="Both parents discovered" />
                <UIcon v-else-if="!discoveredIds.has(plant.id)" name="i-lucide-lock" class="size-3 text-muted/25" />
              </div>

              <div class="flex-1 flex items-center justify-center relative">
                <div v-if="discoveredIds.has(plant.id)" class="absolute size-16 rounded-full bg-current opacity-[0.07] blur-xl" :class="tierColor(plant.tier)" />
                <XenoPlantIcon :id="plant.id" :size="64" class="relative transition-all" :class="discoveredIds.has(plant.id) ? 'xeno-sway' : 'xeno-silhouette'" />
                <span v-if="!discoveredIds.has(plant.id)" class="absolute text-2xl font-black text-muted/40 select-none">?</span>
              </div>

              <p class="text-xs font-bold text-center px-1.5 mb-1.5 truncate" :class="discoveredIds.has(plant.id) ? tierNameColor(plant.tier) : 'text-muted/40'">
                {{ discoveredIds.has(plant.id) ? plant.name : (withinReach.has(plant.id) ? plant.name : '???') }}
              </p>

              <div class="flex divide-x divide-default/40 border-t border-default/40" :class="!discoveredIds.has(plant.id) && 'opacity-20'">
                <div class="flex-1 flex items-center justify-center gap-1 py-1.5">
                  <UIcon name="i-lucide-zap" class="size-3 shrink-0" :class="discoveredIds.has(plant.id) ? levelTextColor(plant.speed) : 'text-muted'" />
                  <span class="text-xs font-black tabular-nums" :class="discoveredIds.has(plant.id) ? levelTextColor(plant.speed) : 'text-muted'">{{ plant.speed }}</span>
                </div>
                <div class="flex-1 flex items-center justify-center gap-1 py-1.5">
                  <UIcon name="i-lucide-gem" class="size-3 shrink-0" :class="discoveredIds.has(plant.id) ? levelTextColor(plant.yield) : 'text-muted'" />
                  <span class="text-xs font-black tabular-nums" :class="discoveredIds.has(plant.id) ? levelTextColor(plant.yield) : 'text-muted'">{{ plant.yield }}</span>
                </div>
              </div>
            </div>
          </UTooltip>
        </div>
      </section>
    </div>
  </UContainer>
</template>
