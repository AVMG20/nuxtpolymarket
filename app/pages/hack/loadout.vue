<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_STYLE, CLASS_LABEL, CLASS_ICON,
  SLOT_ICON, SLOT_LABEL, RARITY_ORDER,
  agentPower, agentBonusStats, itemPower,
  type HackRarity, type AgentClass, type ItemSlot, type ItemMod, type AgentTrait,
} from '#shared/utils/hack-config'

type InvItem = { id: string; name: string; slot: ItemSlot; itemLevel: number; rarity: HackRarity; mods: ItemMod[]; equippedBy?: string | null }
type Gear = { tool: InvItem | null, software: InvItem | null, hardware: InvItem | null }
type Agent = {
  id: string; name: string; class: AgentClass; rarity: HackRarity; level: number; power: number
  traits: AgentTrait[]; gear: Gear; active: boolean; onOp: boolean
}

const SLOTS: ItemSlot[] = ['tool', 'software', 'hardware']

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { data: state, refresh } = await useFetch('/api/hack/state')

const roster = computed<Agent[]>(() => [...(state.value?.agents ?? []), ...(state.value?.storedAgents ?? [])] as Agent[])

// Deep-linked from Agents cards via ?agent={id} (PLAN.md §2.2). Falls back to
// the first roster agent, and re-settles if the selected agent gets fired.
const selectedAgentId = ref<string | null>((route.query.agent as string) ?? null)
watch(roster, (list) => {
  if (!list.some(a => a.id === selectedAgentId.value)) selectedAgentId.value = list[0]?.id ?? null
}, { immediate: true })

const selectedAgent = computed(() => roster.value.find(a => a.id === selectedAgentId.value) ?? null)

function selectAgent(id: string) {
  selectedAgentId.value = id
  router.replace({ query: { ...route.query, agent: id } })
  mobileRosterOpen.value = false
}

// ── Gear bays ────────────────────────────────────────────────────────
const selectedSlot = ref<ItemSlot>('tool')
function selectBay(slot: ItemSlot) {
  selectedSlot.value = slot
  slotFilter.value = slot
}

const agentCombinedStats = computed(() =>
  selectedAgent.value ? agentBonusStats([selectedAgent.value]) : [])

// ── Inventory rail ───────────────────────────────────────────────────
const mobileRosterOpen = ref(false)
const mobileInventoryOpen = ref(false)
const slotFilter = ref<ItemSlot | 'all'>('tool')
const sortOptions = [
  { value: 'value', label: 'Value' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'type', label: 'Type' },
] as const
const sortBy = ref<'value' | 'rarity' | 'type'>('rarity')
const sortDir = ref<'desc' | 'asc'>('desc')

const filteredItems = computed<InvItem[]>(() => {
  const items = ((state.value?.items ?? []) as InvItem[])
    .filter(i => slotFilter.value === 'all' || i.slot === slotFilter.value)
  const dir = sortDir.value === 'asc' ? 1 : -1
  items.sort((a, b) => {
    let cmp = 0
    if (sortBy.value === 'value') cmp = itemPower(a) - itemPower(b)
    else if (sortBy.value === 'rarity') cmp = RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
    else cmp = a.slot.localeCompare(b.slot)
    if (cmp === 0) cmp = itemPower(a) - itemPower(b)
    return cmp * dir
  })
  return items
})

// ── Stat math — same collectBonuses-family functions the rest of the app
// uses, called twice (current gear vs. candidate gear) so the comparison
// overlay can never drift from what equip actually applies. ────────────
function gearWith(gear: Gear, slot: ItemSlot, item: InvItem | null): Gear {
  return { ...gear, [slot]: item }
}
function gearList(gear: Gear) {
  return SLOTS.map(s => gear[s]).filter((i): i is InvItem => !!i).map(i => ({ itemLevel: i.itemLevel, mods: i.mods }))
}
function statsFor(agent: Agent, gear: Gear) {
  const power = agentPower({ level: agent.level, class: agent.class }, gearList(gear), agent.traits)
  // "Power" is folded into the `power` total above already — the bonus list
  // is everything else (loot/speed/gem/xp/etc).
  const bonuses = agentBonusStats([{ class: agent.class, traits: agent.traits, gear }])
    .filter(s => s.label !== 'Power')
  return { power, bonuses }
}

// ── Comparison overlay ───────────────────────────────────────────────
const compareItemId = ref<string | null>(null)
const compareOpen = computed({
  get: () => compareItemId.value !== null,
  set: (v: boolean) => { if (!v) compareItemId.value = null },
})
const compareCandidate = computed<InvItem | null>(() =>
  ((state.value?.items ?? []) as InvItem[]).find(i => i.id === compareItemId.value) ?? null)
const compareSlot = computed(() => compareCandidate.value?.slot ?? null)
const compareCurrent = computed<InvItem | null>(() =>
  (compareSlot.value && selectedAgent.value) ? selectedAgent.value.gear[compareSlot.value] : null)

const compareBefore = computed(() => selectedAgent.value ? statsFor(selectedAgent.value, selectedAgent.value.gear) : null)
const compareAfter = computed(() => {
  if (!selectedAgent.value || !compareSlot.value) return null
  return statsFor(selectedAgent.value, gearWith(selectedAgent.value.gear, compareSlot.value, compareCandidate.value))
})
const compareDeltaRows = computed(() => {
  if (!compareBefore.value || !compareAfter.value) return []
  const labels = new Set([
    ...compareBefore.value.bonuses.map(s => s.label),
    ...compareAfter.value.bonuses.map(s => s.label),
  ])
  return [...labels].map((label) => {
    const b = compareBefore.value!.bonuses.find(s => s.label === label)
    const a = compareAfter.value!.bonuses.find(s => s.label === label)
    const fmt = (b ?? a)!.fmt
    const bv = b?.value ?? 0
    const av = a?.value ?? 0
    return { label, beforeText: fmt(bv), afterText: fmt(av), up: av > bv, down: av < bv }
  })
})

function openCompare(itemId: string) {
  if (!selectedAgent.value) return
  compareItemId.value = itemId
}

const equipping = ref(false)
async function confirmSwap() {
  if (!compareCandidate.value || !selectedAgent.value) return
  equipping.value = true
  try {
    await $fetch('/api/hack/items/equip', {
      method: 'POST',
      body: { itemId: compareCandidate.value.id, agentId: selectedAgent.value.id },
    })
    toast.add({ title: `${compareCandidate.value.name} equipped`, color: 'success' })
    compareItemId.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Equip failed', color: 'error' })
  } finally { equipping.value = false }
}

async function unequip(item: InvItem) {
  equipping.value = true
  try {
    await $fetch('/api/hack/items/equip', { method: 'POST', body: { itemId: item.id, agentId: null } })
    toast.add({ title: 'Item unequipped', color: 'neutral' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Failed', color: 'error' })
  } finally { equipping.value = false }
}

// ── Drag-to-equip — click-to-place always works (accessible/mobile path);
// this adds the power-user path on top of the same openCompare() gate.
const draggingId = ref<string | null>(null)
const dragOverSlot = ref<ItemSlot | null>(null)
function onDragOverBay(slot: ItemSlot) {
  const item = ((state.value?.items ?? []) as InvItem[]).find(i => i.id === draggingId.value)
  if (item?.slot === slot) dragOverSlot.value = slot
}
function onDropOnBay(slot: ItemSlot) {
  dragOverSlot.value = null
  const id = draggingId.value
  draggingId.value = null
  if (!id) return
  const item = ((state.value?.items ?? []) as InvItem[]).find(i => i.id === id)
  if (item?.slot === slot) openCompare(id)
}
</script>

<template>
  <div class="flex h-full min-h-0">
    <!-- ── Roster rail (desktop) ──────────────────────────────────── -->
    <div class="hidden lg:flex flex-col w-64 shrink-0 border-r border-default overflow-y-auto">
      <div class="p-3 space-y-4 pb-12">
        <template v-if="state?.agents.length">
          <p class="text-sm font-semibold text-muted uppercase tracking-wide px-1">Active</p>
          <div class="space-y-1">
            <button v-for="a in (state.agents as Agent[])" :key="a.id" type="button"
              class="w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors"
              :class="selectedAgentId === a.id ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-elevated'"
              @click="selectAgent(a.id)"
            >
              <div class="size-9 rounded-lg flex items-center justify-center shrink-0 ring-1"
                :class="[RARITY_STYLE[a.rarity].bg, RARITY_STYLE[a.rarity].ring, RARITY_STYLE[a.rarity].text]">
                <UIcon :name="CLASS_ICON[a.class]" class="size-4" />
              </div>
              <div class="min-w-0">
                <p class="font-medium text-sm truncate">{{ a.name }}</p>
                <p class="text-xs" :class="RARITY_STYLE[a.rarity].text">{{ RARITY_LABEL[a.rarity] }} · Lv{{ a.level }}</p>
              </div>
            </button>
          </div>
        </template>
        <template v-if="state?.storedAgents.length">
          <p class="text-sm font-semibold text-muted uppercase tracking-wide px-1">Storage</p>
          <div class="space-y-1">
            <button v-for="a in (state.storedAgents as Agent[])" :key="a.id" type="button"
              class="w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors"
              :class="selectedAgentId === a.id ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-elevated'"
              @click="selectAgent(a.id)"
            >
              <div class="size-9 rounded-lg flex items-center justify-center shrink-0 ring-1"
                :class="[RARITY_STYLE[a.rarity].bg, RARITY_STYLE[a.rarity].ring, RARITY_STYLE[a.rarity].text]">
                <UIcon :name="CLASS_ICON[a.class]" class="size-4" />
              </div>
              <div class="min-w-0">
                <p class="font-medium text-sm truncate">{{ a.name }}</p>
                <p class="text-xs" :class="RARITY_STYLE[a.rarity].text">{{ RARITY_LABEL[a.rarity] }} · Lv{{ a.level }}</p>
              </div>
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- ── Main: operator card ───────────────────────────────────── -->
    <div class="flex-1 min-w-0 overflow-y-auto p-6 space-y-6 pb-12">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 class="text-2xl font-bold">Loadout</h1>
          <p class="text-sm text-muted mt-0.5">Equip gear and compare before/after stats.</p>
        </div>
        <div class="flex items-center gap-2 lg:hidden">
          <UButton icon="i-lucide-users" label="Roster" variant="soft" color="neutral" size="sm" @click="mobileRosterOpen = true" />
          <UButton icon="i-lucide-package" label="Inventory" variant="soft" color="neutral" size="sm" @click="mobileInventoryOpen = true" />
        </div>
      </div>

      <div v-if="!state" class="grid grid-cols-1">
        <USkeleton class="h-96 rounded-xl" />
      </div>

      <div v-else-if="!selectedAgent" class="text-center py-16 text-muted">
        <UIcon name="i-lucide-user-x" class="size-8 mx-auto mb-2 opacity-30" />
        No agents yet — recruit one at the Black Market.
      </div>

      <HackFrame v-else accent class="p-6">
        <div class="text-center mb-6">
          <div class="size-16 rounded-xl flex items-center justify-center mx-auto mb-3 ring-1"
            :class="[RARITY_STYLE[selectedAgent.rarity].bg, RARITY_STYLE[selectedAgent.rarity].ring, RARITY_STYLE[selectedAgent.rarity].text]">
            <UIcon :name="CLASS_ICON[selectedAgent.class]" class="size-8" />
          </div>
          <div class="flex items-center justify-center gap-2 flex-wrap">
            <span class="font-bold text-xl">{{ selectedAgent.name }}</span>
            <UBadge :color="RARITY_COLOR[selectedAgent.rarity]" variant="subtle" :label="RARITY_LABEL[selectedAgent.rarity]" />
          </div>
          <p class="text-sm text-muted font-mono mt-1">
            {{ CLASS_LABEL[selectedAgent.class] }} · Lv {{ selectedAgent.level }} ·
            <span class="text-primary font-semibold">PWR {{ selectedAgent.power }}</span>
          </p>
        </div>

        <p class="hack-stat-label-md mb-2">Gear bays — click or drag from inventory</p>
        <div class="space-y-2 mb-5">
          <div v-for="slot in SLOTS" :key="slot"
            class="flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer"
            :class="[
              selectedSlot === slot ? 'border-primary bg-primary/10' : 'border-default hover:border-primary/40',
              dragOverSlot === slot && 'border-primary bg-primary/15',
            ]"
            @click="selectBay(slot)"
            @dragover.prevent="onDragOverBay(slot)"
            @dragleave="dragOverSlot === slot && (dragOverSlot = null)"
            @drop.prevent="onDropOnBay(slot)"
          >
            <div class="size-9 rounded-md flex items-center justify-center shrink-0 bg-elevated text-muted">
              <UIcon :name="SLOT_ICON[slot]" class="size-4" />
            </div>
            <div class="flex-1 min-w-0">
              <template v-if="selectedAgent.gear[slot]">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-medium text-sm">{{ selectedAgent.gear[slot]!.name }}</span>
                  <UBadge size="xs" :color="RARITY_COLOR[selectedAgent.gear[slot]!.rarity]" variant="subtle" :label="RARITY_LABEL[selectedAgent.gear[slot]!.rarity]" />
                </div>
                <p class="text-xs text-muted font-mono">{{ SLOT_LABEL[slot] }} · Lv {{ selectedAgent.gear[slot]!.itemLevel }} · +{{ itemPower(selectedAgent.gear[slot]!) }} PWR</p>
              </template>
              <template v-else>
                <p class="text-sm text-muted">Empty {{ SLOT_LABEL[slot] }} slot</p>
                <p class="text-xs text-muted">Drop a {{ slot }} item here</p>
              </template>
            </div>
            <UButton v-if="selectedAgent.gear[slot]" size="xs" color="neutral" variant="outline" icon="i-lucide-link-slash"
              label="Unequip" :loading="equipping" @click.stop="unequip(selectedAgent.gear[slot]!)" />
          </div>
        </div>

        <hr class="border-default">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <div>
            <p class="hack-stat-label-md">Power</p>
            <p class="hack-stat-value-lg text-primary">{{ selectedAgent.power }}</p>
          </div>
          <div v-for="s in agentCombinedStats" :key="s.label">
            <p class="hack-stat-label-md">{{ s.label }}</p>
            <p class="hack-stat-value-lg">{{ s.fmt(s.value) }}</p>
          </div>
        </div>
      </HackFrame>
    </div>

    <!-- ── Inventory rail (desktop) ─────────────────────────────── -->
    <div class="hidden lg:flex flex-col w-80 shrink-0 border-l border-default overflow-y-auto">
      <div class="p-4 space-y-3 pb-12">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-base">Inventory</h2>
          <span class="text-sm text-muted">{{ state?.inventoryCount ?? 0 }}/{{ state?.maxInventorySlots ?? 30 }}</span>
        </div>

        <div class="hack-seg">
          <button type="button" :class="slotFilter === 'all' && 'active'" @click="slotFilter = 'all'">All</button>
          <button type="button" :class="slotFilter === 'tool' && 'active'" @click="slotFilter = 'tool'">Tool</button>
          <button type="button" :class="slotFilter === 'software' && 'active'" @click="slotFilter = 'software'">Soft</button>
          <button type="button" :class="slotFilter === 'hardware' && 'active'" @click="slotFilter = 'hardware'">HW</button>
        </div>

        <div class="flex items-center gap-1">
          <UButtonGroup size="xs" class="flex-1">
            <UButton
              v-for="opt in sortOptions" :key="opt.value"
              :color="sortBy === opt.value ? 'primary' : 'neutral'"
              :variant="sortBy === opt.value ? 'solid' : 'outline'"
              class="flex-1 justify-center" :label="opt.label"
              @click="sortBy = opt.value"
            />
          </UButtonGroup>
          <UButton
            size="xs" color="neutral" variant="outline"
            :icon="sortDir === 'desc' ? 'i-lucide-arrow-down-wide-narrow' : 'i-lucide-arrow-up-narrow-wide'"
            @click="sortDir = sortDir === 'desc' ? 'asc' : 'desc'"
          />
        </div>

        <div v-if="!filteredItems.length" class="text-sm text-muted text-center py-8">
          <UIcon name="i-lucide-package-open" class="size-8 mx-auto mb-2 opacity-30" />
          No matching gear.
          <UButton block size="sm" class="mt-3" to="/hack/market" icon="i-lucide-store" label="Visit the Black Market" variant="soft" />
        </div>
        <div v-else class="space-y-2">
          <div v-for="item in filteredItems" :key="item.id"
            draggable="true"
            @dragstart="draggingId = item.id"
            @dragend="draggingId = null"
          >
            <HackItemCard :item="item" :selected="compareItemId === item.id" @select="openCompare(item.id)" />
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Mobile roster slideover -->
  <USlideover v-model:open="mobileRosterOpen" title="Roster" side="left" class="lg:hidden">
    <template #body>
      <div class="p-2 space-y-1 overflow-y-auto h-full">
        <button v-for="a in roster" :key="a.id" type="button"
          class="w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors"
          :class="selectedAgentId === a.id ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-elevated'"
          @click="selectAgent(a.id)"
        >
          <div class="size-9 rounded-lg flex items-center justify-center shrink-0 ring-1"
            :class="[RARITY_STYLE[a.rarity].bg, RARITY_STYLE[a.rarity].ring, RARITY_STYLE[a.rarity].text]">
            <UIcon :name="CLASS_ICON[a.class]" class="size-4" />
          </div>
          <div class="min-w-0">
            <p class="font-medium text-sm truncate">{{ a.name }}</p>
            <p class="text-xs" :class="RARITY_STYLE[a.rarity].text">{{ RARITY_LABEL[a.rarity] }} · Lv{{ a.level }}{{ a.active ? '' : ' · Storage' }}</p>
          </div>
        </button>
      </div>
    </template>
  </USlideover>

  <!-- Mobile inventory slideover -->
  <USlideover v-model:open="mobileInventoryOpen" title="Inventory" side="right" class="lg:hidden">
    <template #body>
      <div class="p-4 space-y-3 overflow-y-auto h-full">
        <div class="hack-seg">
          <button type="button" :class="slotFilter === 'all' && 'active'" @click="slotFilter = 'all'">All</button>
          <button type="button" :class="slotFilter === 'tool' && 'active'" @click="slotFilter = 'tool'">Tool</button>
          <button type="button" :class="slotFilter === 'software' && 'active'" @click="slotFilter = 'software'">Soft</button>
          <button type="button" :class="slotFilter === 'hardware' && 'active'" @click="slotFilter = 'hardware'">HW</button>
        </div>
        <div v-if="!filteredItems.length" class="text-sm text-muted text-center py-8">No matching gear.</div>
        <div v-else class="space-y-2">
          <HackItemCard v-for="item in filteredItems" :key="item.id" :item="item"
            :selected="compareItemId === item.id"
            @select="openCompare(item.id); mobileInventoryOpen = false" />
        </div>
      </div>
    </template>
  </USlideover>

  <!-- ── Comparison overlay ───────────────────────────────────────── -->
  <UModal v-model:open="compareOpen" :ui="{ content: 'max-w-2xl bg-transparent shadow-none ring-0 rounded-none' }">
    <template #content>
      <HackFrame accent class="hack-shell overflow-hidden">
        <div class="p-5 border-b border-default">
          <p class="hack-eyebrow">Compare — {{ compareSlot ? SLOT_LABEL[compareSlot] : '' }} slot</p>
          <h3 class="text-lg font-bold mt-1">Currently equipped vs. candidate</h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
          <div>
            <UBadge color="neutral" variant="subtle" :label="compareCurrent ? 'Currently equipped' : 'Slot empty'" class="mb-2" />
            <HackItemCard v-if="compareCurrent" :item="compareCurrent" />
            <p v-else class="text-sm text-muted text-center py-10">Nothing equipped here yet.</p>
          </div>
          <div>
            <UBadge :color="compareCandidate ? RARITY_COLOR[compareCandidate.rarity] : 'neutral'" variant="subtle" label="Candidate" class="mb-2" />
            <HackItemCard v-if="compareCandidate" :item="compareCandidate" />
          </div>
        </div>

        <div class="p-5 border-t border-default">
          <p class="hack-stat-label-md mb-2">Impact on {{ selectedAgent?.name }}</p>
          <div class="flex items-center justify-between text-sm py-2 border-b border-default">
            <span>Power</span>
            <span class="font-semibold"
              :class="(compareAfter?.power ?? 0) > (compareBefore?.power ?? 0) ? 'text-success' : (compareAfter?.power ?? 0) < (compareBefore?.power ?? 0) ? 'text-error' : 'text-muted'">
              {{ compareBefore?.power ?? 0 }} → {{ compareAfter?.power ?? 0 }}
            </span>
          </div>
          <div v-for="row in compareDeltaRows" :key="row.label" class="flex items-center justify-between text-sm py-2 border-b border-default last:border-none">
            <span>{{ row.label }}</span>
            <span class="font-semibold" :class="row.up ? 'text-success' : row.down ? 'text-error' : 'text-muted'">
              {{ row.beforeText }} → {{ row.afterText }}
            </span>
          </div>

          <div class="flex items-center justify-between gap-3 mt-5">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="compareItemId = null" />
            <UButton color="primary" label="Confirm Swap" :loading="equipping" @click="confirmSwap" />
          </div>
        </div>
      </HackFrame>
    </template>
  </UModal>
</template>
