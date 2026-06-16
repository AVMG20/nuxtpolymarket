<script setup lang="ts">
import {
  tierLabel, tierColor, plantColor, plantCardBg, plantRing, levelTextColor,
  ARTIFACT_TYPES, getArtifact, getPlant,
  effectiveGrowTime,
} from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const props = defineProps<{
  inventory: any[]     // grouped by (typeId, speed, yield), enriched with config data
  freeArtifacts: any[]
  selectedPlantKey?: string | null   // "typeId:speed:yield"
  selectedArtifactId?: string | null
}>()

const emit = defineEmits<{
  selectPlant: [payload: { typeId: string; speed: number; yield: number; name: string; emoji: string; tier: number } | null]
  selectArtifact: [payload: { id: string; typeId: string; chargesRemaining: number } | null]
}>()

const activeTab = ref<'seeds' | 'artifacts'>('seeds')

// Plant selection (key = "typeId:speed:yield")
function onSelectPlant(item: any) {
  const key = `${item.typeId}:${item.speed}:${item.yield}`
  if (props.selectedPlantKey === key) {
    emit('selectPlant', null)
  } else {
    emit('selectPlant', { typeId: item.typeId, speed: item.speed, yield: item.yield, name: item.name, emoji: item.emoji, tier: item.tier })
  }
}

// Artifact selection
function onSelectArtifact(a: any) {
  if (props.selectedArtifactId === a.id) {
    emit('selectArtifact', null)
  } else {
    emit('selectArtifact', { id: a.id, typeId: a.typeId, chargesRemaining: a.chargesRemaining })
  }
}

// Total owned plants of a given typeId (any speed/yield)
function ownedQty(plantTypeId: string): number {
  return props.inventory
    .filter(i => i.typeId === plantTypeId)
    .reduce((sum, i) => sum + i.quantity, 0)
}

const sortedInventory = computed(() =>
  [...props.inventory].sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier
    if (b.yield !== a.yield) return b.yield - a.yield
    return b.speed - a.speed
  }),
)

// Format artifact effect for display
function effectLabel(effect: { type: string; value: number }): string {
  switch (effect.type) {
    case 'grid_speed_boost': return `−${Math.round(effect.value * 100)}% grow time`
    case 'grid_yield_bonus': return `+${effect.value} yield per harvest`
    case 'breeder_extra_yield': return `+${effect.value} extra plant/breed`
    case 'breeder_mutation_boost': return `+${Math.round(effect.value * 100)}% mutation chance`
    default: return effect.type
  }
}

function effectTarget(type: string): string {
  return type.startsWith('grid_') ? 'Grid' : 'Breeder'
}

// For each owned artifact, find its ARTIFACT_TYPES definition (for cost display)
function getArtifactDef(typeId: string) {
  return ARTIFACT_TYPES.find(a => a.id === typeId)
}
</script>

<template>
  <!-- Tabs -->
  <div class="flex border-b border-default shrink-0">
    <button
      class="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-100"
      :class="activeTab === 'seeds' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
      @click="activeTab = 'seeds'"
    >
      Seeds
    </button>
    <button
      class="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-100 relative"
      :class="activeTab === 'artifacts' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
      @click="activeTab = 'artifacts'"
    >
      Artifacts
      <span v-if="freeArtifacts.length" class="absolute top-1.5 right-3 size-4 flex items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
        {{ freeArtifacts.length }}
      </span>
    </button>
  </div>

  <!-- ── Seeds tab ─────────────────────────────────────────── -->
  <div v-if="activeTab === 'seeds'" class="flex-1 overflow-y-auto">
    <div v-if="!inventory.length" class="py-12 text-center px-4">
      <UIcon name="i-lucide-sprout" class="size-8 text-muted/30 mx-auto mb-2" />
      <p class="text-sm text-muted">No plants yet.</p>
      <p class="text-xs text-muted/50 mt-1">Harvest from the grid first.</p>
    </div>

    <div v-else class="p-2 grid grid-cols-3 gap-1.5">
      <!-- All plant stacks with tooltip -->
      <UTooltip
        v-for="item in sortedInventory"
        :key="`${item.typeId}:${item.speed}:${item.yield}`"
        :delay-duration="300"
      >
        <template #content>
          <div class="w-56 p-3 space-y-3 bg-elevated border border-default rounded-xl shadow-xl">
            <!-- Header -->
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="font-bold text-sm">{{ item.name }}</p>
                <p class="text-xs font-bold uppercase tracking-wider mt-0.5" :class="plantColor(item.color)">
                  {{ item.quantity }} remaining
                </p>
              </div>
              <span class="text-xs font-bold bg-elevated border border-default rounded-full px-2 py-0.5 shrink-0">
                TIER {{ item.tier }}
              </span>
            </div>

            <USeparator />

            <!-- Speed / Yield levels -->
            <div class="space-y-1.5">
              <XenoStatLevel label="Speed" :level="item.speed" color="bg-warning" />
              <XenoStatLevel label="Yield" :level="item.yield" color="bg-info" />
            </div>

            <USeparator />

            <!-- Stats -->
            <div class="space-y-1">
              <div class="flex justify-between text-xs">
                <span class="text-muted uppercase tracking-wider font-semibold">Growth</span>
                <span class="font-mono">{{ formatDuration(effectiveGrowTime({ baseTime: item.baseTime, speed: item.speed })) }}</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-muted uppercase tracking-wider font-semibold">Yield</span>
                <span class="font-mono">1–{{ 1 + item.yield }} units</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-muted uppercase tracking-wider font-semibold">Value</span>
                <span class="font-mono" :class="plantColor(item.color)">
                  ${{ formatNumber(item.value, false) }}–${{ formatNumber(item.value * (1 + item.yield), false) }}
                </span>
              </div>
            </div>

            <!-- Description -->
            <p v-if="item.description" class="text-xs text-muted/70 italic">{{ item.description }}</p>
          </div>
        </template>

        <!-- Plant card — game-style layout -->
        <button
          class="relative flex flex-col rounded-xl border border-default aspect-square w-full overflow-hidden transition-all duration-100"
          :class="[plantCardBg(item.color), selectedPlantKey === `${item.typeId}:${item.speed}:${item.yield}` ? plantRing(item.color) : '']"
          @click="onSelectPlant(item)"
        >
          <!-- Tier + qty header -->
          <div class="flex items-center justify-between px-1.5 pt-1.5 shrink-0">
            <span
              class="text-xs font-bold leading-none"
              :class="tierColor(item.tier)"
            >{{ tierLabel(item.tier) }}</span>
            <span class="text-xs font-black text-success leading-none">×{{ item.quantity }}</span>
          </div>

          <!-- Emoji -->
          <div class="flex-1 flex items-center justify-center">
            <span class="text-3xl leading-none select-none">{{ item.emoji }}</span>
          </div>

          <!-- Name -->
          <p class="text-xs font-bold text-center px-1 mb-1 truncate" :class="plantColor(item.color)">{{ item.name }}</p>

          <!-- Stat strip -->
          <div class="flex divide-x border-t bg-black/15 dark:bg-black/35"
               style="border-color: rgba(0,0,0,0.12)">
            <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
              <UIcon name="i-lucide-zap" class="size-2.5 shrink-0" :class="levelTextColor(item.speed)" />
              <span class="text-xs font-black tabular-nums" :class="levelTextColor(item.speed)">{{ item.speed }}</span>
            </div>
            <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
              <UIcon name="i-lucide-gem" class="size-2.5 shrink-0" :class="levelTextColor(item.yield)" />
              <span class="text-xs font-black tabular-nums" :class="levelTextColor(item.yield)">{{ item.yield }}</span>
            </div>
          </div>
        </button>
      </UTooltip>
    </div>
  </div>

  <!-- ── Artifacts tab ──────────────────────────────────────── -->
  <div v-else class="flex-1 overflow-y-auto p-3 space-y-2">
    <div v-if="!freeArtifacts.length" class="py-12 text-center px-4">
      <UIcon name="i-lucide-flask-conical" class="size-8 text-muted/30 mx-auto mb-2" />
      <p class="text-sm text-muted">No artifacts.</p>
      <p class="text-xs text-muted/50 mt-1">Craft them in the Artifacts shop.</p>
    </div>

    <div
      v-for="a in freeArtifacts"
      :key="a.id"
      class="rounded-xl border cursor-pointer transition-all duration-100 overflow-hidden"
      :class="selectedArtifactId === a.id
        ? 'border-primary bg-primary/5 ring-1 ring-primary'
        : 'border-default bg-elevated hover:border-default/80 hover:bg-elevated/80'"
      @click="onSelectArtifact(a)"
    >
      <!-- Artifact header -->
      <div class="flex items-center gap-2.5 px-3 pt-3 pb-2">
        <span class="text-xl leading-none">{{ getArtifact(a.typeId)?.emoji }}</span>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold truncate">{{ getArtifact(a.typeId)?.name }}</p>
          <p class="text-xs text-muted">{{ effectTarget(getArtifact(a.typeId)?.effect.type ?? '') }}</p>
        </div>
        <!-- Charges -->
        <div class="text-right shrink-0">
          <p class="text-xs font-bold" :class="a.chargesRemaining <= 2 ? 'text-error' : 'text-default'">
            {{ a.chargesRemaining }}/{{ getArtifactDef(a.typeId)?.maxCharges }}
          </p>
          <p class="text-xs text-muted">uses</p>
        </div>
      </div>

      <!-- Spec list -->
      <div class="mx-3 mb-2 rounded-lg bg-background/40 border border-default/40 overflow-hidden">
        <div class="flex items-center justify-between px-2.5 py-1.5 border-b border-default/30">
          <span class="text-xs text-muted uppercase tracking-wider font-semibold">Effect</span>
          <span class="text-xs font-bold text-primary">
            {{ effectLabel(getArtifact(a.typeId)?.effect ?? { type: '', value: 0 }) }}
          </span>
        </div>
        <div class="flex items-center justify-between px-2.5 py-1.5">
          <span class="text-xs text-muted uppercase tracking-wider font-semibold">Charges left</span>
          <div class="flex items-center gap-0.5">
            <div
              v-for="n in (getArtifactDef(a.typeId)?.maxCharges ?? 1)"
              :key="n"
              class="size-2 rounded-full"
              :class="n <= a.chargesRemaining ? 'bg-primary' : 'bg-elevated border border-default/40'"
            />
          </div>
        </div>
      </div>

      <!-- Craft-another cost tracking -->
      <div v-if="getArtifactDef(a.typeId)?.cost.length" class="mx-3 mb-3">
        <p class="text-xs text-muted uppercase tracking-wider font-semibold mb-1.5">Re-craft needs</p>
        <div class="space-y-1">
          <div
            v-for="c in getArtifactDef(a.typeId)?.cost"
            :key="c.plantTypeId"
            class="flex items-center justify-between"
          >
            <div class="flex items-center gap-1.5">
              <span class="text-sm leading-none">{{ getPlant(c.plantTypeId)?.emoji }}</span>
              <span class="text-xs text-muted truncate">{{ getPlant(c.plantTypeId)?.name }}</span>
            </div>
            <span
              class="text-xs font-bold tabular-nums"
              :class="ownedQty(c.plantTypeId) >= c.quantity ? 'text-success' : 'text-error'"
            >
              {{ ownedQty(c.plantTypeId) }}/{{ c.quantity }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
