<script setup lang="ts">
import { ARTIFACT_TYPES, getArtifact, getPlant, artifactStatRows } from '#shared/utils/xeno'
import { artifactEffectSummary, roman, tierClass } from '~/lib/xeno-ui'

// The shelf: seed stacks and free artifacts as a grid of cards. Variants of
// one species (different speed / yield) sit together under a small header.
const props = defineProps<{
  inventory: any[]
  freeArtifacts: any[]
  selectedPlantKey?: string | null
  selectedArtifactId?: string | null
  /** Which slot type these artifacts are used in — controls copy and sort options. */
  artifactDomain?: 'grid' | 'breeder'
  /** Optional third tab rendered from the `extra` slot (the Nursery's recipe finder). */
  extraLabel?: string
}>()

const emit = defineEmits<{
  selectPlant: [payload: { typeId: string, speed: number, yield: number, name: string, emoji: string, tier: number } | null]
  selectArtifact: [payload: { id: string, typeId: string, chargesRemaining: number, gemCrafted: boolean } | null]
}>()

const { deleteArtifacts } = useXeno()
const sound = useXenoSound()

type ShelfTab = 'seeds' | 'artifacts' | 'extra'
const activeTab = defineModel<ShelfTab>('tab', { default: 'seeds' })
function setTab(t: ShelfTab) {
  if (activeTab.value === t) return
  activeTab.value = t
  sound.play('select')
}

const domain = computed<'grid' | 'breeder'>(() => props.artifactDomain ?? 'grid')

function stackKey(item: { typeId: string, speed: number, yield: number }) {
  return `${item.typeId}:${item.speed}:${item.yield}`
}

function onSelectPlant(item: any) {
  if (props.selectedPlantKey === stackKey(item)) emit('selectPlant', null)
  else emit('selectPlant', { typeId: item.typeId, speed: item.speed, yield: item.yield, name: item.name, emoji: item.emoji, tier: item.tier })
}

// ── Sorting (persisted, one setting per tab/domain) ──────────────────────────
interface SortState { key: string, dir: 'asc' | 'desc' }
interface SortCookie { seeds: SortState, artifactsGrid: SortState, artifactsBreeder: SortState }

const sortCookie = useCookie<SortCookie>('xeno-inventory-sort', {
  default: () => ({
    seeds: { key: 'tier', dir: 'desc' },
    artifactsGrid: { key: 'qty', dir: 'desc' },
    artifactsBreeder: { key: 'qty', dir: 'desc' }
  })
})
const sortSlot = computed<keyof SortCookie>(() =>
  activeTab.value === 'seeds' ? 'seeds' : (domain.value === 'breeder' ? 'artifactsBreeder' : 'artifactsGrid'))

const seedSortOptions = [
  { label: 'Tier', value: 'tier' },
  { label: 'Stack value', value: 'value' },
  { label: 'Quantity', value: 'qty' },
  { label: 'Speed', value: 'speed' },
  { label: 'Yield', value: 'yield' },
  { label: 'Name', value: 'name' }
]
const artifactSortOptions = computed(() => {
  const base = [
    { label: 'Quantity', value: 'qty' },
    { label: 'Charges', value: 'charges' },
    { label: 'Level', value: 'level' },
    { label: 'Speed', value: 'speed' },
    { label: 'Yield', value: 'yield' }
  ]
  return domain.value === 'breeder' ? [...base, { label: 'Mutation', value: 'mutation' }] : base
})
const sortOptions = computed(() => activeTab.value === 'seeds' ? seedSortOptions : artifactSortOptions.value)
const sortKey = computed<string>({
  get: () => sortCookie.value[sortSlot.value]?.key ?? 'qty',
  set: (v) => { sortCookie.value = { ...sortCookie.value, [sortSlot.value]: { ...sortCookie.value[sortSlot.value], key: v } } }
})
const sortDir = computed(() => sortCookie.value[sortSlot.value]?.dir ?? 'desc')
function toggleSortDir() {
  const s = sortSlot.value
  sortCookie.value = { ...sortCookie.value, [s]: { ...sortCookie.value[s], dir: sortCookie.value[s].dir === 'asc' ? 'desc' : 'asc' } }
}

// ── Seeds ────────────────────────────────────────────────────────────────────
const search = ref('')
const tierFilter = ref(0)

const tiersPresent = computed(() => [...new Set(props.inventory.map((i: any) => i.tier as number))].sort((a, b) => a - b))
watch(tiersPresent, (t) => { if (tierFilter.value && !t.includes(tierFilter.value)) tierFilter.value = 0 })

const speciesCount = computed(() => new Set(props.inventory.map((i: any) => i.typeId)).size)

interface SeedGroup { typeId: string, name: string, tier: number, isVoid: boolean, isHybrid: boolean, total: number, value: number, best: number, variants: any[] }

const groups = computed<SeedGroup[]>(() => {
  const q = search.value.trim().toLowerCase()
  const map = new Map<string, SeedGroup>()
  for (const item of props.inventory) {
    if (tierFilter.value && item.tier !== tierFilter.value) continue
    if (q && !String(item.name).toLowerCase().includes(q)
      && !(item.resources ?? []).some((r: any) => String(r.name).toLowerCase().includes(q))) continue
    let g = map.get(item.typeId)
    if (!g) {
      g = { typeId: item.typeId, name: item.name, tier: item.tier, isVoid: !!getPlant(item.typeId)?.voidPlant, isHybrid: !!item.isHybrid, total: 0, value: 0, best: 0, variants: [] }
      map.set(item.typeId, g)
    }
    g.total += item.quantity
    g.value += item.value * item.quantity
    g.variants.push(item)
  }
  const { key, dir } = sortCookie.value.seeds
  const mult = dir === 'asc' ? 1 : -1
  const val = (g: SeedGroup): number | string => {
    switch (key) {
      case 'tier': return g.tier
      case 'value': return g.value
      case 'qty': return g.total
      case 'speed': return Math.max(...g.variants.map(v => v.speed))
      case 'yield': return Math.max(...g.variants.map(v => v.yield))
      default: return g.name
    }
  }
  const list = [...map.values()]
  for (const g of list) {
    g.variants.sort((a, b) => key === 'qty' ? b.quantity - a.quantity : (b.speed + b.yield) - (a.speed + a.yield) || b.quantity - a.quantity)
  }
  return list.sort((a, b) => {
    const av = val(a)
    const bv = val(b)
    if (typeof av === 'string' || typeof bv === 'string') return mult * String(av).localeCompare(String(bv))
    if (av !== bv) return mult * (av - bv)
    return a.name.localeCompare(b.name)
  })
})

// ── Artifacts ────────────────────────────────────────────────────────────────
const stackedArtifacts = computed(() => {
  const m = new Map<string, { typeId: string, chargesRemaining: number, gemCrafted: boolean, ids: string[], count: number }>()
  for (const a of props.freeArtifacts) {
    const key = `${a.typeId}:${a.chargesRemaining}:${a.gemCrafted ? 1 : 0}`
    const g = m.get(key)
    if (g) {
      g.ids.push(a.id)
      g.count++
    } else {
      m.set(key, { typeId: a.typeId, chargesRemaining: a.chargesRemaining, gemCrafted: !!a.gemCrafted, ids: [a.id], count: 1 })
    }
  }
  return [...m.values()]
})

function stackKeyOf(s: { typeId: string, chargesRemaining: number, gemCrafted: boolean }) {
  return `${s.typeId}:${s.chargesRemaining}:${s.gemCrafted ? 1 : 0}`
}
function statLevel(s: { typeId: string, gemCrafted: boolean }, label: string): number {
  const art = getArtifact(s.typeId)
  return art ? artifactStatRows(art, s.gemCrafted).find(r => r.label === label)?.level ?? 0 : 0
}
function artifactSortValue(s: any, key: string): number {
  switch (key) {
    case 'qty': return s.count
    case 'charges': return s.chargesRemaining
    case 'level': return getArtifact(s.typeId)?.level ?? 0
    case 'speed': return statLevel(s, 'Speed')
    case 'yield': return statLevel(s, 'Yield')
    case 'mutation': return statLevel(s, 'Mutation')
    default: return 0
  }
}
const sortedArtifacts = computed(() => {
  const st = sortCookie.value[domain.value === 'breeder' ? 'artifactsBreeder' : 'artifactsGrid']
  const mult = st?.dir === 'asc' ? 1 : -1
  return [...stackedArtifacts.value].sort((a, b) => {
    const av = artifactSortValue(a, st?.key ?? 'qty')
    const bv = artifactSortValue(b, st?.key ?? 'qty')
    if (av !== bv) return mult * (av - bv)
    return (getArtifact(a.typeId)?.name ?? '').localeCompare(getArtifact(b.typeId)?.name ?? '')
  })
})
const maxCharges = (typeId: string) => getArtifact(typeId)?.maxCharges ?? Math.max(...ARTIFACT_TYPES.map(a => a.maxCharges))

function isStackSelected(s: { ids: string[] }) {
  return props.selectedArtifactId != null && s.ids.includes(props.selectedArtifactId)
}
function onSelectStack(s: { typeId: string, chargesRemaining: number, gemCrafted: boolean, ids: string[] }) {
  if (isStackSelected(s)) emit('selectArtifact', null)
  else emit('selectArtifact', { id: s.ids[0]!, typeId: s.typeId, chargesRemaining: s.chargesRemaining, gemCrafted: s.gemCrafted })
}

// Delete: the first press arms it, a second press within 3s deletes (no refund).
const deleteConfirmKey = ref<string | null>(null)
const deleting = ref<Record<string, boolean>>({})
let deleteTimer: ReturnType<typeof setTimeout> | null = null
function clearDeleteConfirm() {
  if (deleteTimer) { clearTimeout(deleteTimer); deleteTimer = null }
  deleteConfirmKey.value = null
}
async function onDeleteClick(s: { typeId: string, chargesRemaining: number, gemCrafted: boolean, ids: string[] }) {
  const key = stackKeyOf(s)
  if (deleteConfirmKey.value === key) {
    clearDeleteConfirm()
    deleting.value[key] = true
    try {
      await deleteArtifacts(s.ids)
      if (isStackSelected(s)) emit('selectArtifact', null)
    } catch { sound.play('error') } finally {
      delete deleting.value[key]
    }
  } else {
    deleteConfirmKey.value = key
    if (deleteTimer) clearTimeout(deleteTimer)
    deleteTimer = setTimeout(clearDeleteConfirm, 3000)
  }
}
watch(() => props.selectedArtifactId, () => clearDeleteConfirm())
onUnmounted(() => { if (deleteTimer) clearTimeout(deleteTimer) })

const tooltipUi = { content: 'h-auto p-0 bg-transparent ring-0 shadow-none' }
</script>

<template>
  <div class="flex flex-col gap-3 min-h-0 h-full">
    <div class="xg-seg shrink-0" role="tablist" aria-label="Shelf">
      <button type="button" role="tab" :aria-selected="activeTab === 'seeds'" :class="activeTab === 'seeds' ? 'on' : ''" @click="setTab('seeds')">
        Seeds <span class="xg-count">{{ speciesCount }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="activeTab === 'artifacts'" :class="activeTab === 'artifacts' ? 'on' : ''" @click="setTab('artifacts')">
        Artifacts <span class="xg-count">{{ freeArtifacts.length }}</span>
      </button>
      <button v-if="extraLabel" type="button" role="tab" :aria-selected="activeTab === 'extra'" :class="activeTab === 'extra' ? 'on' : ''" @click="setTab('extra')">
        {{ extraLabel }}
      </button>
    </div>

    <slot v-if="activeTab === 'extra'" name="extra" />

    <div v-else class="flex items-center gap-2 shrink-0">
      <UInput
        v-if="activeTab === 'seeds'"
        v-model="search"
        placeholder="Search seeds"
        icon="i-lucide-search"
        size="lg"
        class="flex-1 min-w-0"
        :ui="{ base: 'rounded-full h-10', trailing: 'pe-1.5' }"
        aria-label="Search seeds"
      >
        <template v-if="search" #trailing>
          <UButton color="neutral" variant="link" size="xs" icon="i-lucide-x" aria-label="Clear search" @click="search = ''" />
        </template>
      </UInput>
      <USelect
        v-model="sortKey"
        :items="sortOptions"
        size="lg"
        :class="activeTab === 'seeds' ? 'w-36 shrink-0' : 'flex-1'"
        :ui="{ base: 'rounded-full h-10' }"
        aria-label="Sort by"
      />
      <button
        type="button"
        class="xg-btn ico shrink-0 !min-h-10 size-10"
        :aria-label="sortDir === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'"
        :title="sortDir === 'asc' ? 'Ascending' : 'Descending'"
        @click="toggleSortDir"
      >
        <UIcon :name="sortDir === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'" class="size-4" />
      </button>
    </div>

    <!-- ── Seeds ─────────────────────────────────────────────────────────── -->
    <template v-if="activeTab === 'seeds'">
      <div v-if="tiersPresent.length > 1" class="flex flex-wrap gap-1.5 shrink-0" role="group" aria-label="Filter by tier">
        <button type="button" class="xg-filter" :class="tierFilter === 0 ? 'on' : ''" :aria-pressed="tierFilter === 0" @click="tierFilter = 0">All</button>
        <button
          v-for="t in tiersPresent"
          :key="t"
          type="button"
          class="xg-filter"
          :class="tierFilter === t ? 'on' : ''"
          :aria-pressed="tierFilter === t"
          :aria-label="`Tier ${t}`"
          @click="tierFilter = tierFilter === t ? 0 : t"
        >
          <span class="xg-tier" :class="tierClass(t)">{{ roman(t) }}</span>
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 -mt-1 pt-1 pb-1">
        <div v-if="!inventory.length" class="xg-well py-10 px-4 text-center">
          <UIcon name="i-lucide-sprout" class="size-7 text-(--xg-faint) mx-auto" />
          <p class="text-sm font-extrabold mt-2">No seeds on the shelf</p>
          <p class="text-xs text-(--xg-muted) mt-1">Buy seeds in the Market or harvest a planter.</p>
        </div>
        <div v-else-if="!groups.length" class="xg-well py-10 px-4 text-center">
          <p class="text-sm font-extrabold">No seeds match</p>
          <p class="text-xs text-(--xg-muted) mt-1">Clear the search or pick another tier.</p>
        </div>

        <div v-else class="grid grid-cols-3 gap-2">
          <template v-for="g in groups" :key="g.typeId">
            <p v-if="g.variants.length > 1" class="col-span-full flex items-center gap-2 pt-2 first:pt-0 text-xs">
              <span class="xg-leaf" :class="tierClass(g.tier, g.isVoid)" />
              <b class="truncate">{{ g.name }}</b>
              <span class="text-(--xg-faint)">{{ g.variants.length }} variants</span>
              <span class="ml-auto xg-q text-(--xg-muted)">{{ formatNumber(g.total) }}</span>
            </p>
            <UTooltip
              v-for="item in g.variants"
              :key="stackKey(item)"
              :delay-duration="350"
              :content="{ side: 'left', sideOffset: 8 }"
              :ui="tooltipUi"
            >
              <template #content>
                <XenoPlantTooltipContent
                  :id="item.typeId"
                  :name="item.name"
                  :tier="item.tier"
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
                type="button"
                class="relative flex flex-col items-stretch rounded-[14px_14px_14px_4px] border text-left overflow-hidden transition-colors"
                :class="selectedPlantKey === stackKey(item)
                  ? 'border-(--xg-accent) bg-(--xg-accent-soft) shadow-[inset_0_0_0_1px_var(--xg-accent)]'
                  : 'border-(--xg-edge) bg-(--xg-surface2) hover:border-(--xg-edge2)'"
                :aria-pressed="selectedPlantKey === stackKey(item)"
                :aria-label="`${item.name}${item.isHybrid ? ' hybrid' : `, speed ${item.speed}, yield ${item.yield}`}, ${item.quantity} on the shelf`"
                @click="onSelectPlant(item)"
              >
                <span class="flex items-center justify-between px-2 pt-1.5 gap-1">
                  <span v-if="item.isHybrid" class="xg-chip sky !h-[18px] !px-1.5 !text-[10px]">Hybrid</span>
                  <span v-else class="xg-leaf" :class="tierClass(item.tier, g.isVoid)" :title="`Tier ${roman(item.tier)}${g.isVoid ? ' · void' : ''}`" />
                  <span class="xg-q text-[13px]">{{ formatNumber(item.quantity) }}</span>
                </span>
                <span class="flex justify-center pt-0.5">
                  <XenoPlantIcon :id="item.typeId" :size="52" stage="ready" />
                </span>
                <span class="px-2 pb-1.5 text-[12px] font-bold truncate text-center">{{ item.name }}</span>
                <span v-if="item.isHybrid" class="flex items-center justify-center gap-1 border-t border-(--xg-edge) py-1 text-[11px] font-bold text-(--xg-muted)">
                  <XenoPlantIcon v-for="(r, i) in item.resources" :key="i" :id="r.id" :size="14" />
                </span>
                <span v-else class="grid grid-cols-2 divide-x divide-(--xg-edge) border-t border-(--xg-edge) text-[11.5px] xg-num">
                  <span class="flex items-center justify-center gap-1 py-1 text-(--xg-muted)" title="Speed">
                    <UIcon name="i-lucide-zap" class="size-3" /><b class="text-(--xg-ink)">{{ item.speed }}</b>
                  </span>
                  <span class="flex items-center justify-center gap-1 py-1 text-(--xg-muted)" title="Yield">
                    <UIcon name="i-lucide-droplet" class="size-3" /><b class="text-(--xg-ink)">{{ item.yield }}</b>
                  </span>
                </span>
              </button>
            </UTooltip>
          </template>
        </div>
      </div>
    </template>

    <!-- ── Artifacts ─────────────────────────────────────────────────────── -->
    <template v-else-if="activeTab === 'artifacts'">
      <p class="text-xs text-(--xg-muted) shrink-0">
        <template v-if="domain === 'grid'">Hold an artifact, then click a planter to fit it (a fitted one is swapped back to the shelf). One charge is used per harvest. Void seeds need a tier II+ artifact.</template>
        <template v-else>Hold an artifact, then click a pod's artifact slot. One charge is used per breed.</template>
      </p>
      <div class="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 -mt-1 pt-1 pb-1">
        <div v-if="!sortedArtifacts.length" class="xg-well py-10 px-4 text-center">
          <UIcon name="i-lucide-gem" class="size-7 text-(--xg-faint) mx-auto" />
          <p class="text-sm font-extrabold mt-2">No {{ domain === 'grid' ? 'planter' : 'pod' }} artifacts</p>
          <p class="text-xs text-(--xg-muted) mt-1">Craft them from spare plants.</p>
        </div>
        <div v-else class="grid grid-cols-2 gap-2">
          <div
            v-for="s in sortedArtifacts"
            :key="stackKeyOf(s)"
            class="flex flex-col rounded-[14px_14px_14px_4px] border transition-colors"
            :class="isStackSelected(s) ? 'border-(--xg-accent) bg-(--xg-accent-soft) shadow-[inset_0_0_0_1px_var(--xg-accent)]' : 'border-(--xg-edge) bg-(--xg-surface2) hover:border-(--xg-edge2)'"
          >
            <button
              type="button"
              class="flex flex-col gap-2 p-2.5 text-left"
              :aria-pressed="isStackSelected(s)"
              @click="onSelectStack(s)"
            >
              <span class="flex items-start justify-between gap-2">
                <XenoArtifactGlyph :type-id="s.typeId" :gem-crafted="s.gemCrafted" :size="38" />
                <span class="xg-q text-[13px]">×{{ s.count }}</span>
              </span>
              <span class="min-w-0">
                <b class="block text-[12.5px] leading-tight truncate">{{ getArtifact(s.typeId)?.name }}</b>
                <span class="block text-[11px] text-(--xg-muted) leading-snug mt-0.5">{{ artifactEffectSummary(s.typeId, s.gemCrafted) }}</span>
              </span>
              <span class="flex items-center gap-2">
                <span class="xg-meter flex-1 !h-1"><span :style="{ width: `${Math.min(100, (s.chargesRemaining / maxCharges(s.typeId)) * 100)}%`, background: 'var(--xg-ink)' }" /></span>
                <span class="text-[11px] font-bold xg-num text-(--xg-muted)">{{ s.chargesRemaining }}/{{ maxCharges(s.typeId) }}</span>
              </span>
            </button>
            <div v-if="isStackSelected(s)" class="px-2.5 pb-2.5">
              <XenoButton
                size="xs"
                block
                :variant="deleteConfirmKey === stackKeyOf(s) ? 'danger' : 'ghost'"
                :icon="deleteConfirmKey === stackKeyOf(s) ? 'i-lucide-triangle-alert' : 'i-lucide-trash-2'"
                :label="deleteConfirmKey === stackKeyOf(s) ? `Delete ${s.count}, no refund` : 'Delete'"
                :loading="!!deleting[stackKeyOf(s)]"
                @click="onDeleteClick(s)"
              />
            </div>
          </div>
        </div>
        <NuxtLink to="/xeno/artifacts" class="xg-link text-[13px] inline-block mt-3">Craft more in Artifacts</NuxtLink>
      </div>
    </template>
  </div>
</template>
