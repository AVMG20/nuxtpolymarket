<script setup lang="ts">
import {
  tierNameColor, tierBg, levelTextColor,
  ARTIFACT_TYPES, getArtifact, artifactStatRows,
  type ArtifactType,
} from '#shared/utils/xeno'

const props = defineProps<{
  inventory: any[]
  freeArtifacts: any[]
  selectedPlantKey?: string | null
  selectedArtifactId?: string | null
  /** Which slot type these artifacts are used in — controls which sort/spec columns apply. */
  artifactDomain?: 'grid' | 'breeder'
}>()

const emit = defineEmits<{
  selectPlant: [payload: { typeId: string; speed: number; yield: number; name: string; emoji: string; tier: number } | null]
  selectArtifact: [payload: { id: string; typeId: string; chargesRemaining: number; gemCrafted: boolean } | null]
}>()

const { deleteArtifacts } = useXeno()

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
  const groups = new Map<string, { typeId: string; chargesRemaining: number; gemCrafted: boolean; ids: string[]; count: number }>()
  for (const a of props.freeArtifacts) {
    const key = `${a.typeId}:${a.chargesRemaining}:${a.gemCrafted ? 1 : 0}`
    const group = groups.get(key)
    if (group) {
      group.ids.push(a.id)
      group.count++
    } else {
      groups.set(key, { typeId: a.typeId, chargesRemaining: a.chargesRemaining, gemCrafted: !!a.gemCrafted, ids: [a.id], count: 1 })
    }
  }
  return [...groups.values()]
})

function onSelectStack(stack: { typeId: string; chargesRemaining: number; gemCrafted: boolean; ids: string[] }) {
  if (props.selectedArtifactId != null && stack.ids.includes(props.selectedArtifactId)) {
    emit('selectArtifact', null)
  } else {
    emit('selectArtifact', { id: stack.ids[0]!, typeId: stack.typeId, chargesRemaining: stack.chargesRemaining, gemCrafted: stack.gemCrafted })
  }
}

function isStackSelected(stack: { ids: string[] }): boolean {
  return props.selectedArtifactId != null && stack.ids.includes(props.selectedArtifactId)
}

function stackKeyOf(stack: { typeId: string; chargesRemaining: number; gemCrafted: boolean }) {
  return `${stack.typeId}:${stack.chargesRemaining}:${stack.gemCrafted ? 1 : 0}`
}

function ownedQty(plantTypeId: string): number {
  return props.inventory
    .filter(i => i.typeId === plantTypeId)
    .reduce((sum, i) => sum + i.quantity, 0)
}

function effectTarget(art: ArtifactType | undefined): string {
  if (!art) return ''
  return art.effects.some(e => e.type.startsWith('grid_')) ? 'Grid' : 'Breeder'
}

function getArtifactDef(typeId: string) {
  return ARTIFACT_TYPES.find(a => a.id === typeId)
}

const MAX_CHARGES = Math.max(...ARTIFACT_TYPES.map(a => a.maxCharges))

function specRows(art: ArtifactType | undefined, gemCrafted = false) {
  return art ? artifactStatRows(art, gemCrafted) : []
}

// ── Domain (grid vs breeder) — controls which artifact spec columns exist ──
const domain = computed<'grid' | 'breeder'>(() => {
  if (props.artifactDomain) return props.artifactDomain
  const first = props.freeArtifacts[0]
  const art = first ? getArtifact(first.typeId) : undefined
  return art && effectTarget(art) === 'Breeder' ? 'breeder' : 'grid'
})

// ── Sorting (persisted via cookie, separate config per tab/domain) ─────────
interface SortState { key: string; dir: 'asc' | 'desc' }
interface SortCookie {
  seeds: SortState
  artifactsGrid: SortState
  artifactsBreeder: SortState
}

const sortCookie = useCookie<SortCookie>('xeno-inventory-sort', {
  default: () => ({
    seeds: { key: 'tier', dir: 'desc' },
    artifactsGrid: { key: 'qty', dir: 'desc' },
    artifactsBreeder: { key: 'qty', dir: 'desc' },
  }),
})

const sortSlotKey = computed<keyof SortCookie>(() =>
  activeTab.value === 'seeds' ? 'seeds' : (domain.value === 'breeder' ? 'artifactsBreeder' : 'artifactsGrid'),
)

const seedSortOptions = [
  { label: 'Tier', value: 'tier' },
  { label: 'Quantity', value: 'qty' },
  { label: 'Speed', value: 'speed' },
  { label: 'Yield', value: 'yield' },
  { label: 'Name', value: 'name' },
]

const artifactSortOptions = computed(() => {
  const base = [
    { label: 'Quantity', value: 'qty' },
    { label: 'Charges', value: 'charges' },
    { label: 'Level', value: 'level' },
    { label: 'Speed', value: 'speed' },
    { label: 'Yield', value: 'yield' },
  ]
  return domain.value === 'breeder' ? [...base, { label: 'Mutation', value: 'mutation' }] : base
})

const currentSortOptions = computed(() => activeTab.value === 'seeds' ? seedSortOptions : artifactSortOptions.value)

const currentSortKey = computed<string>({
  get: () => sortCookie.value[sortSlotKey.value].key,
  set: (v) => {
    sortCookie.value = { ...sortCookie.value, [sortSlotKey.value]: { ...sortCookie.value[sortSlotKey.value], key: v } }
  },
})

const currentSortDir = computed(() => sortCookie.value[sortSlotKey.value].dir)

function toggleSortDir() {
  const slot = sortSlotKey.value
  sortCookie.value = {
    ...sortCookie.value,
    [slot]: { ...sortCookie.value[slot], dir: sortCookie.value[slot].dir === 'asc' ? 'desc' : 'asc' },
  }
}

function seedSortValue(item: any, key: string): number | string {
  switch (key) {
    case 'tier': return item.tier
    case 'qty': return item.quantity
    case 'speed': return item.speed
    case 'yield': return item.yield
    case 'name': return item.name
    default: return 0
  }
}

const sortedInventory = computed(() => {
  const { key, dir } = sortCookie.value.seeds
  const mult = dir === 'asc' ? 1 : -1
  return [...props.inventory].sort((a, b) => {
    const av = seedSortValue(a, key)
    const bv = seedSortValue(b, key)
    if (typeof av === 'string' || typeof bv === 'string') {
      return mult * String(av).localeCompare(String(bv))
    }
    if (av !== bv) return mult * (av - bv)
    return String(a.name).localeCompare(String(b.name))
  })
})

function artifactSortValue(stack: { typeId: string; chargesRemaining: number; gemCrafted: boolean; count: number }, key: string): number {
  switch (key) {
    case 'qty': return stack.count
    case 'charges': return stack.chargesRemaining
    case 'level': return getArtifactDef(stack.typeId)?.level ?? 0
    case 'speed': return specRows(getArtifact(stack.typeId), stack.gemCrafted).find(r => r.label === 'Speed')?.level ?? 0
    case 'yield': return specRows(getArtifact(stack.typeId), stack.gemCrafted).find(r => r.label === 'Yield')?.level ?? 0
    case 'mutation': return specRows(getArtifact(stack.typeId), stack.gemCrafted).find(r => r.label === 'Mutation')?.level ?? 0
    default: return 0
  }
}

const sortedArtifacts = computed(() => {
  const { key, dir } = sortCookie.value[sortSlotKey.value]
  const mult = dir === 'asc' ? 1 : -1
  return [...stackedArtifacts.value].sort((a, b) => {
    const av = artifactSortValue(a, key)
    const bv = artifactSortValue(b, key)
    if (av !== bv) return mult * (av - bv)
    return (getArtifact(a.typeId)?.name ?? '').localeCompare(getArtifact(b.typeId)?.name ?? '')
  })
})

// ── Delete artifact (double-click confirm, no refund) ───────────────────────
const deleteConfirmKey = ref<string | null>(null)
const deleting = ref<Record<string, boolean>>({})
let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null

function clearDeleteConfirm() {
  if (deleteConfirmTimer) { clearTimeout(deleteConfirmTimer); deleteConfirmTimer = null }
  deleteConfirmKey.value = null
}

async function onDeleteClick(stack: { typeId: string; chargesRemaining: number; gemCrafted: boolean; ids: string[] }, e: MouseEvent) {
  e.stopPropagation()
  const key = stackKeyOf(stack)
  if (deleteConfirmKey.value === key) {
    clearDeleteConfirm()
    deleting.value[key] = true
    try {
      await deleteArtifacts(stack.ids)
      if (props.selectedArtifactId != null && stack.ids.includes(props.selectedArtifactId)) {
        emit('selectArtifact', null)
      }
    } finally {
      delete deleting.value[key]
    }
  } else {
    deleteConfirmKey.value = key
    if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer)
    deleteConfirmTimer = setTimeout(clearDeleteConfirm, 3000)
  }
}

watch(() => props.selectedArtifactId, () => clearDeleteConfirm())
onUnmounted(() => { if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer) })
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

  <!-- Sort controls -->
  <div class="flex items-center gap-1.5 px-2.5 py-2 border-b border-default shrink-0">
    <UIcon name="i-lucide-arrow-down-up" class="size-3.5 text-muted shrink-0" />
    <USelect
      v-model="currentSortKey"
      :items="currentSortOptions"
      size="xs"
      class="flex-1 min-w-0"
    />
    <UButton
      :icon="currentSortDir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
      size="xs"
      variant="soft"
      color="neutral"
      :title="currentSortDir === 'asc' ? 'Ascending' : 'Descending'"
      @click="toggleSortDir"
    />
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
            :is-hybrid="item.isHybrid"
            :resources="item.resources"
          />
        </template>

        <button
          class="relative flex flex-col rounded-xl border aspect-square w-full overflow-hidden transition-all duration-100"
          :class="[
            tierBg(item.tier),
            item.isHybrid ? 'border-primary/50 ring-1 ring-primary/30' : 'border-default',
            selectedPlantKey === `${item.typeId}:${item.speed}:${item.yield}` ? 'ring-2 ring-primary' : '',
          ]"
          @click="onSelectPlant(item)"
        >
          <!-- Tier + qty header -->
          <div class="flex items-center px-1.5 pt-1.5 shrink-0" :class="item.isHybrid ? 'justify-between' : 'justify-end'">
            <span
              v-if="item.isHybrid"
              class="text-[8px] font-black uppercase tracking-wider px-1 py-0.5 rounded bg-primary/20 text-primary leading-none"
            >🧬</span>
            <span class="text-xs font-black text-primary leading-none">{{ item.quantity }}</span>
          </div>

          <!-- Emoji -->
          <div class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-0">
            <XenoPlantIcon :id="item.typeId" :size="40" />
            <div v-if="item.isHybrid" class="flex items-center gap-0.5 leading-none">
              <XenoPlantIcon v-for="(r, i) in item.resources" :key="i" :id="r.id" :size="14" />
            </div>
          </div>

          <!-- Name -->
          <p class="text-xs font-bold text-center px-1 mb-1 truncate" :class="tierNameColor(item.tier)">{{ item.name }}</p>

          <!-- Stat strip — per-resource stats live in the tooltip for hybrids -->
          <div
            v-if="item.isHybrid"
            class="flex items-center justify-center gap-1 py-1 border-t border-default text-primary"
          >
            <UIcon name="i-lucide-layers" class="size-2.5 shrink-0" />
            <span class="text-[10px] font-black tabular-nums">{{ item.resources.length }} plant{{ item.resources.length === 1 ? '' : 's' }}</span>
          </div>
          <div v-else class="flex divide-x divide-default border-t border-default">
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
    <div v-if="!sortedArtifacts.length" class="py-12 text-center px-4">
      <UIcon name="i-lucide-flask-conical" class="size-8 text-muted/30 mx-auto mb-2" />
      <p class="text-sm text-muted">No artifacts.</p>
      <p class="text-xs text-muted/50 mt-1">Craft them in the Artifacts shop.</p>
    </div>

    <div
      v-for="stack in sortedArtifacts"
      :key="stackKeyOf(stack)"
      class="rounded-xl border cursor-pointer transition-all duration-100 overflow-hidden"
      :class="isStackSelected(stack)
        ? 'border-primary bg-primary/5 ring-1 ring-primary'
        : stack.gemCrafted
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20 hover:border-primary/60'
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
            <span
              v-if="stack.gemCrafted"
              class="text-[10px] font-bold px-1 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 leading-none shrink-0 flex items-center gap-0.5"
            ><UIcon name="i-lucide-sparkles" class="size-2.5" /> +1</span>
          </div>
          <p class="text-[11px] text-muted leading-none mt-0.5">{{ effectTarget(getArtifact(stack.typeId)) }}</p>
        </div>
        <span class="text-sm font-black text-primary leading-none shrink-0">×{{ stack.count }}</span>
      </div>

      <!-- Spec rows -->
      <div class="px-3 pt-2 pb-2.5 space-y-1.5">
        <XenoStatLevel
          v-for="row in specRows(getArtifact(stack.typeId), stack.gemCrafted).filter(r => r.level > 0)"
          :key="row.label"
          :label="row.label"
          :level="row.level"
          :max="row.max"
          :color="row.color"
        />
        <XenoStatLevel label="Charges" :level="stack.chargesRemaining" :max="MAX_CHARGES" color="bg-primary" />
      </div>

      <!-- Delete (double-click to confirm — no refund) -->
      <div v-if="isStackSelected(stack)" class="px-3 pb-2.5 pt-0.5" @click.stop>
        <UButton
          block
          size="xs"
          :color="deleteConfirmKey === stackKeyOf(stack) ? 'error' : 'neutral'"
          :variant="deleteConfirmKey === stackKeyOf(stack) ? 'solid' : 'soft'"
          :icon="deleteConfirmKey === stackKeyOf(stack) ? 'i-lucide-alert-triangle' : 'i-lucide-trash-2'"
          :label="deleteConfirmKey === stackKeyOf(stack) ? 'Confirm delete — no refund' : 'Delete'"
          :loading="!!deleting[stackKeyOf(stack)]"
          @click="onDeleteClick(stack, $event)"
        />
      </div>
    </div>
  </div>
</template>
