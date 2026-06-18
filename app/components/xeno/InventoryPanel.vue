<script setup lang="ts">
import {
  plantCardBg, plantRing, plantColor, levelTextColor,
  ARTIFACT_TYPES, getArtifact, getPlant, ARTIFACT_SPEED_PER_LEVEL,
  type ArtifactType,
} from '#shared/utils/xeno'

const props = defineProps<{
  inventory: any[]
  freeArtifacts: any[]
  selectedPlantKey?: string | null
  selectedArtifactId?: string | null
}>()

const emit = defineEmits<{
  selectPlant: [payload: { typeId: string; speed: number; yield: number; name: string; emoji: string; tier: number } | null]
  selectArtifact: [payload: { id: string; typeId: string; chargesRemaining: number } | null]
}>()

const activeTab = ref<'seeds' | 'artifacts'>('seeds')

function onSelectPlant(item: any) {
  const key = `${item.typeId}:${item.speed}:${item.yield}`
  if (props.selectedPlantKey === key) {
    emit('selectPlant', null)
  } else {
    emit('selectPlant', { typeId: item.typeId, speed: item.speed, yield: item.yield, name: item.name, emoji: item.emoji, tier: item.tier })
  }
}

// ── Artifact stacking ──────────────────────────────────────────────────────
// Group free artifacts by (typeId + chargesRemaining). Same charges = same stack.
const stackedArtifacts = computed(() => {
  const groups = new Map<string, { typeId: string; chargesRemaining: number; ids: string[]; count: number }>()
  for (const a of props.freeArtifacts) {
    const key = `${a.typeId}:${a.chargesRemaining}`
    const group = groups.get(key)
    if (group) {
      group.ids.push(a.id)
      group.count++
    } else {
      groups.set(key, { typeId: a.typeId, chargesRemaining: a.chargesRemaining, ids: [a.id], count: 1 })
    }
  }
  return [...groups.values()]
})

function onSelectStack(stack: { typeId: string; chargesRemaining: number; ids: string[] }) {
  if (props.selectedArtifactId != null && stack.ids.includes(props.selectedArtifactId)) {
    emit('selectArtifact', null)
  } else {
    emit('selectArtifact', { id: stack.ids[0]!, typeId: stack.typeId, chargesRemaining: stack.chargesRemaining })
  }
}

function isStackSelected(stack: { ids: string[] }): boolean {
  return props.selectedArtifactId != null && stack.ids.includes(props.selectedArtifactId)
}

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

function effectTarget(art: ArtifactType | undefined): string {
  if (!art) return ''
  return art.effects.some(e => e.type.startsWith('grid_')) ? 'Grid' : 'Breeder'
}

function getArtifactDef(typeId: string) {
  return ARTIFACT_TYPES.find(a => a.id === typeId)
}

const MUTATION_PER_LEVEL = 0.05
function toSpeedLevel(pct: number) { return Math.round(Math.round(pct * 1000) / Math.round(ARTIFACT_SPEED_PER_LEVEL * 1000)) }
function toMutLevel(pct: number) { return Math.ceil(Math.round(pct * 1000) / Math.round(MUTATION_PER_LEVEL * 1000)) }

const MAX_CHARGES     = Math.max(...ARTIFACT_TYPES.map(a => a.maxCharges))
const MAX_SPEED_LVL   = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'grid_speed_boost').map(e => toSpeedLevel(e.value))), 1)
const MAX_YIELD_LVL   = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'grid_yield_bonus').map(e => e.value)), 1)
const MAX_EXTRA_LVL   = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'breeder_extra_yield').map(e => e.value)), 1)
const MAX_MUT_LVL     = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'breeder_mutation_boost').map(e => toMutLevel(e.value))), 1)
const MAX_B_SPEED_LVL = Math.max(...ARTIFACT_TYPES.flatMap(a => a.effects.filter(e => e.type === 'breeder_speed_boost').map(e => toSpeedLevel(e.value))), 1)

function specRows(art: ArtifactType | undefined) {
  if (!art) return []
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
      <span v-if="freeArtifacts.length" class="absolute top-1.5 right-3 size-5 flex items-center justify-center rounded-full bg-primary text-xs font-bold text-inverted">
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
      <UTooltip
        v-for="item in sortedInventory"
        :key="`${item.typeId}:${item.speed}:${item.yield}`"
        :delay-duration="300"
        :content="{ side: 'left', sideOffset: 8 }"
      >
        <template #content>
          <XenoPlantTooltipContent
            :name="item.name"
            :tier="item.tier"
            :color="item.color"
            :speed="item.speed"
            :yield="item.yield"
            :base-time="item.baseTime"
            :value="item.value"
            :description="item.description"
            :quantity="item.quantity"
          />
        </template>

        <button
          class="relative flex flex-col rounded-xl border border-default aspect-square w-full overflow-hidden transition-all duration-100"
          :class="[plantCardBg(item.color), selectedPlantKey === `${item.typeId}:${item.speed}:${item.yield}` ? plantRing(item.color) : '']"
          @click="onSelectPlant(item)"
        >
          <!-- Tier + qty header -->
          <div class="flex items-center justify-between px-1.5 pt-1.5 shrink-0">
            <XenoTierLabel :tier="item.tier" />
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
    <div v-if="!stackedArtifacts.length" class="py-12 text-center px-4">
      <UIcon name="i-lucide-flask-conical" class="size-8 text-muted/30 mx-auto mb-2" />
      <p class="text-sm text-muted">No artifacts.</p>
      <p class="text-xs text-muted/50 mt-1">Craft them in the Artifacts shop.</p>
    </div>

    <div
      v-for="stack in stackedArtifacts"
      :key="`${stack.typeId}:${stack.chargesRemaining}`"
      class="rounded-xl border cursor-pointer transition-all duration-100 overflow-hidden"
      :class="isStackSelected(stack)
        ? 'border-primary bg-primary/5 ring-1 ring-primary'
        : 'border-default bg-elevated hover:border-default/80 hover:bg-elevated/80'"
      @click="onSelectStack(stack)"
    >
      <!-- Artifact header -->
      <div class="flex items-center gap-2 px-3 pt-2.5 pb-0">
        <span class="text-lg leading-none shrink-0">{{ getArtifact(stack.typeId)?.emoji }}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <p class="text-xs font-semibold truncate">{{ getArtifact(stack.typeId)?.name }}</p>
            <span
              v-if="(getArtifact(stack.typeId)?.effects.length ?? 0) > 1"
              class="text-[10px] font-bold px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 leading-none shrink-0"
            >Hybrid</span>
          </div>
          <p class="text-[11px] text-muted leading-none mt-0.5">{{ effectTarget(getArtifact(stack.typeId)) }}</p>
        </div>
        <span class="text-sm font-black text-primary leading-none shrink-0">×{{ stack.count }}</span>
      </div>

      <!-- Spec rows -->
      <div class="px-3 pt-2 pb-2.5 space-y-1.5">
        <XenoStatLevel
          v-for="row in specRows(getArtifact(stack.typeId)).filter(r => r.lvl > 0)"
          :key="row.label"
          :label="row.label"
          :level="row.lvl"
          :max="row.max"
          :color="row.color"
        />
        <XenoStatLevel label="Charges" :level="stack.chargesRemaining" :max="MAX_CHARGES" color="bg-primary" />
      </div>

    </div>
  </div>
</template>
