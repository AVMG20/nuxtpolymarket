<script setup lang="ts">
import {
  PLANT_TYPES,
  MUTATIONS,
  tierLabel,
  tierColor,
  tierBg,
  plantColor,
  plantCardBg,
  levelTextColor,
  effectiveGrowTime,
} from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const { inventory, gridSlots } = useXeno()

// ── Discovery logic ──────────────────────────────────────────────────────────
// A plant type is "discovered" if the user currently has any in inventory or planted in grid.
const discoveredIds = computed(() => {
  const ids = new Set<string>()
  inventory.value.forEach((i: any) => ids.add(i.typeId))
  gridSlots.value.forEach((s: any) => { if (s.plant) ids.add(s.plant.typeId) })
  return ids
})

// ── Tier groupings ───────────────────────────────────────────────────────────
const TIER_LABELS: Record<number, string> = {
  1: 'Starter Tier',
  2: 'Developed Tier',
  3: 'Advanced Tier',
  4: 'Elite Tier',
  5: 'Cosmic Tier',
}

const tiers = computed(() => [1, 2, 3, 4, 5].map(t => ({
  tier: t,
  label: TIER_LABELS[t],
  plants: PLANT_TYPES.filter(p => p.tier === t),
})))

const totalPlants = PLANT_TYPES.length
const discoveredCount = computed(() => PLANT_TYPES.filter(p => discoveredIds.value.has(p.id)).length)

// ── Mutation helpers ─────────────────────────────────────────────────────────
function parentsOf(plantId: string) {
  return MUTATIONS.filter(m => m.offspring === plantId)
}

function offspringOf(plantId: string) {
  return MUTATIONS.filter(m => m.parent1 === plantId || m.parent2 === plantId)
    .map(m => PLANT_TYPES.find(p => p.id === m.offspring))
    .filter(Boolean)
}

function getPlantById(id: string) {
  return PLANT_TYPES.find(p => p.id === id)
}

// ── Mutation recipes per tier ────────────────────────────────────────────────
// Recipes where the offspring belongs to this tier (or crosses into it from below)
function tierMutations(tier: number) {
  const tierPlantIds = new Set(PLANT_TYPES.filter(p => p.tier === tier).map(p => p.id))
  return MUTATIONS.filter(m => tierPlantIds.has(m.offspring))
}
</script>

<template>
  <UContainer>
    <!-- Header -->
    <div class="flex items-start justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold flex items-center gap-2">
          <span>🌿</span> Xenopedia
        </h1>
        <p class="text-sm text-muted mt-0.5">Plant encyclopedia — discover and track all xenoflora species.</p>
      </div>
      <div class="shrink-0">
        <UBadge
          :label="`${discoveredCount} / ${totalPlants} discovered`"
          variant="soft"
          color="success"
          size="lg"
        />
      </div>
    </div>

    <!-- Tier sections -->
    <div class="space-y-10">
      <section v-for="{ tier, label, plants } in tiers" :key="tier">
        <!-- Tier header -->
        <div class="flex items-center gap-3 mb-4">
          <span
            class="text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border"
            :class="[tierBg(tier), tierColor(tier)]"
          >
            TIER {{ tier }}
          </span>
          <p class="text-sm font-semibold text-muted">{{ label }}</p>
          <div class="flex-1 h-px bg-default/40" />
          <p class="text-xs text-muted">
            {{ plants.filter(p => discoveredIds.has(p.id)).length }}/{{ plants.length }}
          </p>
        </div>

        <!-- Mutation recipes — between header and plants -->
        <div v-if="tierMutations(tier).length" class="mb-4">
          <p class="text-xs font-bold uppercase tracking-wider text-muted mb-2">Mutation Recipes</p>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="m in tierMutations(tier)"
              :key="`${m.parent1}-${m.parent2}-${m.offspring}`"
              class="bg-elevated border border-default rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs transition-opacity"
              :class="discoveredIds.has(m.offspring) ? '' : 'opacity-50'"
            >
              <span class="text-base leading-none">{{ getPlantById(m.parent1)?.emoji }}</span>
              <span class="text-muted">+</span>
              <span class="text-base leading-none">{{ getPlantById(m.parent2)?.emoji }}</span>
              <span class="text-muted">→</span>
              <span class="text-base leading-none">{{ getPlantById(m.offspring)?.emoji }}</span>
              <span class="text-muted font-semibold">{{ (m.chance * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </div>

        <!-- Plant cards grid -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <UTooltip
            v-for="plant in plants"
            :key="plant.id"
            :delay-duration="200"
          >
            <template #content>
              <div class="w-64 p-3 space-y-3 bg-elevated border border-default rounded-xl shadow-xl">
                <!-- Tooltip header -->
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="text-2xl leading-none">
                      {{ discoveredIds.has(plant.id) ? plant.emoji : '?' }}
                    </span>
                    <div>
                      <p class="font-bold text-sm">{{ plant.name }}</p>
                      <span
                        class="text-xs font-bold uppercase tracking-wider"
                        :class="discoveredIds.has(plant.id) ? tierColor(plant.tier) : 'text-muted'"
                      >
                        {{ tierLabel(plant.tier) }}
                        <span v-if="plant.isMutation"> · Mutation</span>
                        <span v-else-if="plant.isStarter"> · Starter</span>
                      </span>
                    </div>
                  </div>
                  <div v-if="!discoveredIds.has(plant.id)" class="shrink-0">
                    <UIcon name="i-lucide-lock" class="size-4 text-muted" />
                  </div>
                </div>

                <USeparator />

                <!-- Stats (discovered only) -->
                <template v-if="discoveredIds.has(plant.id)">
                  <div class="space-y-1.5">
                    <XenoStatLevel label="Speed" :level="plant.speed" color="bg-warning" />
                    <XenoStatLevel label="Yield" :level="plant.yield" color="bg-info" />
                  </div>

                  <USeparator />

                  <div class="space-y-1">
                    <div class="flex justify-between text-xs">
                      <span class="text-muted uppercase tracking-wider font-semibold">Base Time</span>
                      <span class="font-mono">{{ formatDuration(plant.baseTime) }}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                      <span class="text-muted uppercase tracking-wider font-semibold">Effective</span>
                      <span class="font-mono">{{ formatDuration(effectiveGrowTime(plant)) }}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                      <span class="text-muted uppercase tracking-wider font-semibold">Yield</span>
                      <span class="font-mono">1–{{ 1 + plant.yield }} units</span>
                    </div>
                    <div class="flex justify-between text-xs">
                      <span class="text-muted uppercase tracking-wider font-semibold">Value</span>
                      <span class="font-mono" :class="plantColor(plant.color)">
                        ${{ formatNumber(plant.value, false) }}–${{ formatNumber(plant.value * (1 + plant.yield), false) }}
                      </span>
                    </div>
                  </div>

                  <USeparator />

                  <!-- How to get -->
                  <div>
                    <p class="text-xs font-bold uppercase tracking-wider text-muted mb-1.5">How to get</p>
                    <template v-if="plant.isStarter">
                      <p class="text-xs text-muted">Starter plant — available from the beginning.</p>
                    </template>
                    <template v-else-if="parentsOf(plant.id).length">
                      <div class="space-y-1">
                        <div
                          v-for="m in parentsOf(plant.id)"
                          :key="`${m.parent1}-${m.parent2}`"
                          class="text-xs text-muted flex items-center gap-1"
                        >
                          <span>{{ getPlantById(m.parent1)?.emoji }}</span>
                          <span>+</span>
                          <span>{{ getPlantById(m.parent2)?.emoji }}</span>
                          <span class="text-muted/60">→</span>
                          <span class="font-semibold text-default">{{ (m.chance * 100).toFixed(0) }}%</span>
                        </div>
                      </div>
                    </template>
                    <template v-else>
                      <p class="text-xs text-muted">No known mutation recipe.</p>
                    </template>
                  </div>

                  <!-- What it can produce -->
                  <div v-if="offspringOf(plant.id).length">
                    <p class="text-xs font-bold uppercase tracking-wider text-muted mb-1.5">Can produce</p>
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="offspring in offspringOf(plant.id)"
                        :key="offspring!.id"
                        class="text-xs flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-default bg-background/50"
                      >
                        <span>{{ offspring!.emoji }}</span>
                        <span :class="tierColor(offspring!.tier)">{{ offspring!.name }}</span>
                      </span>
                    </div>
                  </div>

                  <!-- Description -->
                  <p v-if="plant.description" class="text-xs text-muted/70 italic">{{ plant.description }}</p>
                </template>

                <!-- Undiscovered state -->
                <template v-else>
                  <div class="space-y-1.5 opacity-40">
                    <XenoStatLevel label="Speed" :level="0" color="bg-warning" />
                    <XenoStatLevel label="Yield" :level="0" color="bg-info" />
                  </div>
                  <USeparator />
                  <p class="text-xs text-muted text-center py-1">Not yet discovered</p>
                  <div v-if="parentsOf(plant.id).length">
                    <p class="text-xs font-bold uppercase tracking-wider text-muted mb-1">Hint: How to get</p>
                    <div class="space-y-1">
                      <div
                        v-for="m in parentsOf(plant.id)"
                        :key="`${m.parent1}-${m.parent2}`"
                        class="text-xs text-muted flex items-center gap-1"
                      >
                        <span>{{ getPlantById(m.parent1)?.emoji }}</span>
                        <span>+</span>
                        <span>{{ getPlantById(m.parent2)?.emoji }}</span>
                        <span class="text-muted/60">→</span>
                        <span class="font-semibold">{{ (m.chance * 100).toFixed(0) }}%</span>
                      </div>
                    </div>
                  </div>
                  <template v-else-if="plant.isStarter">
                    <p class="text-xs text-muted">Starter plant.</p>
                  </template>
                </template>
              </div>
            </template>

            <!-- Card — game-style layout (matches inventory panel) -->
            <div
              class="rounded-xl border border-default aspect-square flex flex-col overflow-hidden cursor-default transition-all relative"
              :class="discoveredIds.has(plant.id)
                ? plantCardBg(plant.color)
                : 'opacity-40'"
            >
              <!-- Undiscovered -->
              <template v-if="!discoveredIds.has(plant.id)">
                <div class="flex-1 flex flex-col items-center justify-center gap-1">
                  <UIcon name="i-lucide-lock" class="size-5 text-muted/50" />
                </div>
                <p class="text-xs font-semibold text-muted text-center px-1.5 pb-2 leading-tight">{{ plant.name }}</p>
              </template>

              <!-- Discovered -->
              <template v-else>
                <!-- Tier + mutation badge header -->
                <div class="flex items-center justify-between px-2 pt-2 shrink-0">
                  <span
                    class="text-xs font-bold leading-none"
                    :class="plantColor(plant.color)"
                  >{{ tierLabel(plant.tier) }}</span>
                  <span v-if="plant.isMutation" class="text-xs leading-none">✨</span>
                </div>

                <!-- Emoji -->
                <div class="flex-1 flex items-center justify-center">
                  <span class="text-5xl leading-none select-none">{{ plant.emoji }}</span>
                </div>

                <!-- Name -->
                <p class="text-xs font-bold text-center px-1.5 mb-1.5 truncate">{{ plant.name }}</p>

                <!-- Stat strip -->
                <div class="flex divide-x border-t bg-black/15 dark:bg-black/35"
                     style="border-color: rgba(0,0,0,0.12)">
                  <div class="flex-1 flex items-center justify-center gap-1 py-1.5">
                    <UIcon name="i-lucide-zap" class="size-3 shrink-0" :class="levelTextColor(plant.speed)" />
                    <span class="text-xs font-black tabular-nums" :class="levelTextColor(plant.speed)">{{ plant.speed }}</span>
                  </div>
                  <div class="flex-1 flex items-center justify-center gap-1 py-1.5">
                    <UIcon name="i-lucide-gem" class="size-3 shrink-0" :class="levelTextColor(plant.yield)" />
                    <span class="text-xs font-black tabular-nums" :class="levelTextColor(plant.yield)">{{ plant.yield }}</span>
                  </div>
                </div>
              </template>
            </div>
          </UTooltip>
        </div>

      </section>
    </div>
  </UContainer>
</template>
