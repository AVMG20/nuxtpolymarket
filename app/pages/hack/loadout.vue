<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_STYLE, CLASS_LABEL,
  SLOT_ICON, SLOT_LABEL, RARITY_ORDER, MOD_LABEL, formatModValue, sortModsByPriority,
  agentPower, agentBonusStats, itemPower,
  type HackRarity, type AgentClass, type ItemSlot, type ItemMod, type AgentTrait
} from '#shared/utils/hack-config'
import { CLASS_PORTRAIT } from '~/utils/hack-content'
import { LOADOUT_SWAP, LOADOUT_UNEQUIP, pickVoiceLine, type VoiceEntry } from '~/utils/hack-voice-lines'
import type { VoiceHandle } from '~/composables/useAudio'

type InvItem = { id: string, name: string, slot: ItemSlot, itemLevel: number, rarity: HackRarity, mods: ItemMod[], equippedBy?: string | null }
type Gear = { tool: InvItem | null, software: InvItem | null, hardware: InvItem | null }
type Agent = {
  id: string
  name: string
  class: AgentClass
  rarity: HackRarity
  level: number
  power: number
  traits: AgentTrait[]
  gear: Gear
  active: boolean
  onOp: boolean
}

const SLOTS: ItemSlot[] = ['tool', 'software', 'hardware']

const route = useRoute()
const router = useRouter()
const toast = useToast()
const audio = useAudio('hack')
const { data: state, refresh } = await useFetch('/api/hack/state')

// RELAY's spoken reaction on equip/unequip — audio-only, no-immediate-repeat,
// single-tracked so back-to-back swaps cut the previous line instead of stacking.
// Throttled via barkThrottle (same cadence as reveal barks) so a swap spree
// doesn't talk over itself on every single click.
let barkHandle: VoiceHandle | null = null
function relayBark(entry: VoiceEntry) {
  barkHandle?.cancel()
  if (!audio.barkThrottle()) return
  barkHandle = audio.playVoice(pickVoiceLine(entry).voice, { delayMs: 80 })
}
onUnmounted(() => barkHandle?.cancel())

const agentSortBy = ref<'power' | 'rarity' | 'level'>('power')
const roster = computed<Agent[]>(() => {
  const agents = [...(state.value?.agents ?? []), ...(state.value?.storedAgents ?? [])] as Agent[]
  agents.sort((a, b) => {
    if (agentSortBy.value === 'power') {
      return b.power - a.power
    }
    if (agentSortBy.value === 'level') {
      return b.level - a.level
    }
    const r = RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
    return r !== 0 ? r : b.power - a.power
  })
  return agents
})
const sortedActiveAgents = computed(() => roster.value.filter(a => a.active))
const sortedStoredAgents = computed(() => roster.value.filter(a => !a.active))

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
const slotFilters = [
  { value: 'all', label: 'All' },
  { value: 'tool', label: 'Tool' },
  { value: 'software', label: 'Soft' },
  { value: 'hardware', label: 'HW' }
] as const
const sortOptions = [
  { value: 'rarity', label: 'Rarity' },
  { value: 'power', label: 'Power' },
  { value: 'name', label: 'Name' },
  { value: 'level', label: 'Level' }
] as const
const sortBy = ref<'rarity' | 'power' | 'name' | 'level'>('rarity')

// At-a-glance upgrade/downgrade signal for the inventory rail: each candidate's
// mod chips get colored against whatever the selected agent already has in that
// slot, trait by trait. Null when the slot is empty (nothing to compare against).
function slotCompare(item: InvItem): { equippedMods: ItemMod[] } | null {
  const agent = selectedAgent.value
  if (!agent) return null
  const equipped = agent.gear[item.slot]
  if (!equipped) return null
  return { equippedMods: equipped.mods }
}

const filteredItems = computed<InvItem[]>(() => {
  const items = ((state.value?.items ?? []) as InvItem[])
    .filter(i => slotFilter.value === 'all' || i.slot === slotFilter.value)
  items.sort((a, b) => {
    if (sortBy.value === 'power') {
      return itemPower(b) - itemPower(a)
    }
    if (sortBy.value === 'name') {
      return a.name.localeCompare(b.name)
    }
    if (sortBy.value === 'level') {
      return b.itemLevel - a.itemLevel
    }
    const r = RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
    return r !== 0 ? r : itemPower(b) - itemPower(a)
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
  set: (v: boolean) => { if (!v) compareItemId.value = null }
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
    ...compareAfter.value.bonuses.map(s => s.label)
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
      body: { itemId: compareCandidate.value.id, agentId: selectedAgent.value.id }
    })
    audio.playSfx('loadout-lock')
    relayBark(LOADOUT_SWAP)
    toast.add({ title: `${compareCandidate.value.name} equipped`, color: 'success' })
    compareItemId.value = null
    await refresh()
  } catch (e: any) {
    audio.playSfx('deny')
    toast.add({ title: e.data?.statusMessage ?? 'Equip failed', color: 'error' })
  } finally { equipping.value = false }
}

async function unequip(item: InvItem) {
  equipping.value = true
  try {
    await $fetch('/api/hack/items/equip', { method: 'POST', body: { itemId: item.id, agentId: null } })
    audio.playSfx('loadout-lock')
    relayBark(LOADOUT_UNEQUIP)
    toast.add({ title: 'Item unequipped', color: 'neutral' })
    await refresh()
  } catch (e: any) {
    audio.playSfx('deny')
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
    <div class="hidden lg:block w-64 shrink-0 overflow-y-auto p-3">
      <HackFrame class="py-1.5 pb-2">
        <template v-if="state?.agents.length">
          <div class="px-3.5 pt-2.5 pb-1.5 flex items-center justify-between gap-2">
            <p class="hack-eyebrow">
              Active
            </p>
            <USelect
              v-model="agentSortBy"
              :items="[
                { value: 'power', label: 'Power' },
                { value: 'rarity', label: 'Rarity' },
                { value: 'level', label: 'Level' }
              ]"
              size="xs"
              class="w-28 shrink-0"
            />
          </div>
          <button
            v-for="a in sortedActiveAgents"
            :key="a.id"
            type="button"
            class="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors border-l-2 cursor-pointer"
            :class="selectedAgentId === a.id ? 'bg-primary/10 border-primary' : 'border-transparent hover:bg-elevated'"
            @click="selectAgent(a.id)"
          >
            <div
              class="size-10 shrink-0 overflow-hidden ring-1"
              :class="RARITY_STYLE[a.rarity].ring"
            >
              <img
                :src="CLASS_PORTRAIT[a.class]"
                :alt="CLASS_LABEL[a.class]"
                class="w-full h-full object-cover"
              >
            </div>
            <div class="min-w-0">
              <p class="font-semibold text-sm truncate">
                {{ a.name }}
              </p>
              <p
                class="text-xs font-mono"
                :class="RARITY_STYLE[a.rarity].text"
              >
                {{ RARITY_LABEL[a.rarity] }} · Lv{{ a.level }} · PWR {{ a.power }}
              </p>
            </div>
          </button>
        </template>
        <template v-if="state?.storedAgents.length">
          <p class="hack-eyebrow px-3.5 pt-3 pb-1.5">
            Sleeper
          </p>
          <button
            v-for="a in sortedStoredAgents"
            :key="a.id"
            type="button"
            class="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors border-l-2 cursor-pointer"
            :class="selectedAgentId === a.id ? 'bg-primary/10 border-primary' : 'border-transparent hover:bg-elevated'"
            @click="selectAgent(a.id)"
          >
            <div
              class="size-10 shrink-0 overflow-hidden ring-1"
              :class="RARITY_STYLE[a.rarity].ring"
            >
              <img
                :src="CLASS_PORTRAIT[a.class]"
                :alt="CLASS_LABEL[a.class]"
                class="w-full h-full object-cover"
              >
            </div>
            <div class="min-w-0">
              <p class="font-semibold text-sm truncate">
                {{ a.name }}
              </p>
              <p
                class="text-xs font-mono"
                :class="RARITY_STYLE[a.rarity].text"
              >
                {{ RARITY_LABEL[a.rarity] }} · Lv{{ a.level }} · PWR {{ a.power }}
              </p>
            </div>
          </button>
        </template>
      </HackFrame>
    </div>

    <!-- ── Main: operator card ───────────────────────────────────── -->
    <div class="flex-1 min-w-0 overflow-y-auto p-6 space-y-6 pb-12">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 class="text-2xl font-bold">
            Loadout
          </h1>
          <p class="text-sm text-muted mt-0.5">
            Equip gear and compare before/after stats.
          </p>
        </div>
        <div class="flex items-center gap-2 lg:hidden">
          <UButton
            icon="i-lucide-users"
            label="Roster"
            variant="soft"
            color="neutral"
            size="sm"
            @click="mobileRosterOpen = true"
          />
          <UButton
            icon="i-lucide-package"
            label="Inventory"
            variant="soft"
            color="neutral"
            size="sm"
            @click="mobileInventoryOpen = true"
          />
        </div>
      </div>

      <div
        v-if="!state"
        class="grid grid-cols-1"
      >
        <USkeleton class="h-96 rounded-xl" />
      </div>

      <div
        v-else-if="!selectedAgent"
        class="text-center py-16 text-muted"
      >
        <UIcon
          name="i-lucide-user-x"
          class="size-8 mx-auto mb-2 opacity-30"
        />
        No agents yet — recruit one at the Black Market.
      </div>

      <HackFrame
        v-else
        accent
        class="p-6 max-w-2xl mx-auto"
      >
        <div class="text-center mb-6">
          <div
            class="size-36 mx-auto mb-4 overflow-hidden ring-1"
            :class="RARITY_STYLE[selectedAgent.rarity].ring"
          >
            <img
              :src="CLASS_PORTRAIT[selectedAgent.class]"
              :alt="CLASS_LABEL[selectedAgent.class]"
              class="w-full h-full object-cover"
            >
          </div>
          <div class="flex items-center justify-center gap-2 flex-wrap">
            <span class="font-bold text-2xl">{{ selectedAgent.name }}</span>
            <UBadge
              :color="RARITY_COLOR[selectedAgent.rarity]"
              variant="subtle"
              :label="RARITY_LABEL[selectedAgent.rarity]"
            />
          </div>
          <p class="text-sm text-muted font-mono mt-1.5">
            {{ CLASS_LABEL[selectedAgent.class] }} · Lv {{ selectedAgent.level }} ·
            <span class="text-primary font-semibold">PWR {{ selectedAgent.power }}</span>
          </p>
        </div>

        <p class="hack-stat-label-md mb-2.5">
          Gear bays — click or drag from inventory
        </p>
        <div class="space-y-3 mb-5">
          <div
            v-for="slot in SLOTS"
            :key="slot"
            class="flex items-start gap-4 p-4 border transition-colors cursor-pointer"
            :class="[
              selectedSlot === slot ? 'border-primary bg-primary/10' : 'border-default hover:border-primary/50',
              dragOverSlot === slot && 'border-secondary bg-secondary/10'
            ]"
            @click="selectBay(slot)"
            @dragover.prevent="onDragOverBay(slot)"
            @dragleave="dragOverSlot === slot && (dragOverSlot = null)"
            @drop.prevent="onDropOnBay(slot)"
          >
            <div
              class="size-[52px] shrink-0 flex items-center justify-center border"
              :class="selectedAgent.gear[slot]
                ? [RARITY_STYLE[selectedAgent.gear[slot]!.rarity].border, RARITY_STYLE[selectedAgent.gear[slot]!.rarity].text]
                : 'border-dashed border-default text-muted'"
            >
              <UIcon
                :name="SLOT_ICON[slot]"
                class="size-6"
              />
            </div>
            <div class="flex-1 min-w-0">
              <template v-if="selectedAgent.gear[slot]">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span
                    class="font-bold text-[15px]"
                    :class="RARITY_STYLE[selectedAgent.gear[slot]!.rarity].text"
                  >{{ selectedAgent.gear[slot]!.name }}</span>
                </div>
                <p class="text-xs text-muted font-mono mt-0.5">
                  {{ SLOT_LABEL[slot] }} · Lv {{ selectedAgent.gear[slot]!.itemLevel }} · +{{ itemPower(selectedAgent.gear[slot]!) }} PWR
                </p>
                <div class="flex flex-wrap gap-1.5 mt-2">
                  <HackModChip
                    v-for="m in sortModsByPriority(selectedAgent.gear[slot]!.mods)"
                    :key="m.type"
                    :label="MOD_LABEL[m.type]"
                    :value="formatModValue(m.type, m.value)"
                  />
                </div>
              </template>
              <template v-else>
                <p class="font-bold text-[15px] text-muted">
                  Empty {{ SLOT_LABEL[slot] }} slot
                </p>
                <p class="text-xs text-muted font-mono mt-0.5">
                  Drop a {{ slot }} item here
                </p>
              </template>
            </div>
            <UBadge
              v-if="selectedSlot === slot && !selectedAgent.gear[slot]"
              color="primary"
              variant="subtle"
              label="Selected"
              class="shrink-0"
            />
            <UButton
              v-if="selectedAgent.gear[slot]"
              size="xs"
              color="neutral"
              variant="outline"
              icon="i-lucide-link-2-off"
              label="Unequip"
              :loading="equipping"
              @click.stop="audio.playSfx('click'); unequip(selectedAgent.gear[slot]!)"
            />
          </div>
        </div>

        <hr class="border-default mb-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p class="hack-stat-label-md">
              Power
            </p>
            <p class="hack-stat-value-lg text-primary">
              {{ selectedAgent.power }}
            </p>
          </div>
          <div
            v-for="s in agentCombinedStats"
            :key="s.label"
          >
            <p class="hack-stat-label-md">
              {{ s.label }}
            </p>
            <p class="hack-stat-value-lg">
              {{ s.fmt(s.value) }}
            </p>
          </div>
        </div>
      </HackFrame>
    </div>

    <!-- ── Inventory rail (desktop) ─────────────────────────────── -->
    <div class="hidden lg:block w-96 shrink-0 overflow-y-auto p-3">
      <HackFrame class="p-4">
        <h2 class="hack-stat-label-md mb-3">
          Inventory <span class="text-muted normal-case tracking-normal">— {{ filteredItems.length }} shown / {{ state?.inventoryCount ?? 0 }} total</span>
        </h2>

        <div class="flex gap-1.5 mb-2.5">
          <button
            v-for="f in slotFilters"
            :key="f.value"
            type="button"
            class="hack-filter-btn flex-1"
            :class="slotFilter === f.value && 'active'"
            @click="slotFilter = f.value"
          >
            {{ f.label }}
          </button>
        </div>
        <div class="flex gap-1.5 mb-4">
          <button
            v-for="opt in sortOptions"
            :key="opt.value"
            type="button"
            class="hack-filter-btn flex-1"
            :class="sortBy === opt.value && 'active'"
            @click="sortBy = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>

        <div
          v-if="!filteredItems.length"
          class="text-sm text-muted text-center py-8"
        >
          <UIcon
            name="i-lucide-package-open"
            class="size-8 mx-auto mb-2 opacity-30"
          />
          No matching gear.
        </div>
        <div
          v-else
          class="space-y-2.5 max-h-[62vh] overflow-y-auto pr-1"
        >
          <div
            v-for="item in filteredItems"
            :key="item.id"
            class="cursor-grab"
            draggable="true"
            @dragstart="draggingId = item.id"
            @dragend="draggingId = null"
          >
            <HackItemCard
              :item="item"
              :selected="compareItemId === item.id"
              :compare="slotCompare(item)"
              @select="openCompare(item.id)"
            />
          </div>
        </div>

        <UButton
          block
          class="mt-4"
          color="neutral"
          variant="outline"
          to="/hack/market?tab=gear"
          icon="i-lucide-store"
          label="Need better gear? → Black Market"
        />
      </HackFrame>
    </div>
  </div>

  <!-- Mobile roster slideover -->
  <USlideover
    v-model:open="mobileRosterOpen"
    title="Roster"
    side="left"
    class="lg:hidden"
  >
    <template #body>
      <div class="p-2 space-y-1 overflow-y-auto h-full">
        <button
          v-for="a in roster"
          :key="a.id"
          type="button"
          class="w-full flex items-center gap-3 p-2.5 text-left transition-colors border-l-2 cursor-pointer"
          :class="selectedAgentId === a.id ? 'bg-primary/10 border-primary' : 'border-transparent hover:bg-elevated'"
          @click="selectAgent(a.id)"
        >
          <div
            class="size-10 shrink-0 overflow-hidden ring-1"
            :class="RARITY_STYLE[a.rarity].ring"
          >
            <img
              :src="CLASS_PORTRAIT[a.class]"
              :alt="CLASS_LABEL[a.class]"
              class="w-full h-full object-cover"
            >
          </div>
          <div class="min-w-0">
            <p class="font-semibold text-sm truncate">
              {{ a.name }}
            </p>
            <p
              class="text-xs font-mono"
              :class="RARITY_STYLE[a.rarity].text"
            >
              {{ RARITY_LABEL[a.rarity] }} · Lv{{ a.level }}{{ a.active ? '' : ' · Sleeper' }}
            </p>
          </div>
        </button>
      </div>
    </template>
  </USlideover>

  <!-- Mobile inventory slideover -->
  <USlideover
    v-model:open="mobileInventoryOpen"
    title="Inventory"
    side="right"
    class="lg:hidden"
  >
    <template #body>
      <div class="p-4 space-y-3 overflow-y-auto h-full">
        <div class="flex gap-1.5">
          <button
            v-for="f in slotFilters"
            :key="f.value"
            type="button"
            class="hack-filter-btn flex-1"
            :class="slotFilter === f.value && 'active'"
            @click="slotFilter = f.value"
          >
            {{ f.label }}
          </button>
        </div>
        <div class="flex gap-1.5">
          <button
            v-for="opt in sortOptions"
            :key="opt.value"
            type="button"
            class="hack-filter-btn flex-1"
            :class="sortBy === opt.value && 'active'"
            @click="sortBy = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <div
          v-if="!filteredItems.length"
          class="text-sm text-muted text-center py-8"
        >
          No matching gear.
        </div>
        <div
          v-else
          class="space-y-2.5"
        >
          <HackItemCard
            v-for="item in filteredItems"
            :key="item.id"
            :item="item"
            :selected="compareItemId === item.id"
            :compare="slotCompare(item)"
            @select="openCompare(item.id); mobileInventoryOpen = false"
          />
        </div>
      </div>
    </template>
  </USlideover>

  <!-- ── Comparison overlay ───────────────────────────────────────── -->
  <UModal
    v-model:open="compareOpen"
    :ui="{ content: 'max-w-2xl bg-transparent shadow-none ring-0 rounded-none' }"
  >
    <template #content>
      <HackFrame
        accent
        class="hack-shell overflow-hidden"
      >
        <div class="p-5 border-b border-default">
          <p class="hack-eyebrow">
            Compare — {{ compareSlot ? SLOT_LABEL[compareSlot] : '' }} slot
          </p>
          <h3 class="text-lg font-bold mt-1">
            Currently equipped vs. candidate
          </h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
          <div>
            <UBadge
              color="neutral"
              variant="subtle"
              :label="compareCurrent ? 'Currently equipped' : 'Slot empty'"
              class="mb-2"
            />
            <HackItemCard
              v-if="compareCurrent"
              :item="compareCurrent"
            />
            <p
              v-else
              class="text-sm text-muted text-center py-10"
            >
              Nothing equipped here yet.
            </p>
          </div>
          <div>
            <UBadge
              :color="compareCandidate ? RARITY_COLOR[compareCandidate.rarity] : 'neutral'"
              variant="subtle"
              label="Candidate"
              class="mb-2"
            />
            <HackItemCard
              v-if="compareCandidate"
              :item="compareCandidate"
            />
          </div>
        </div>

        <div class="p-5 border-t border-default">
          <p class="hack-stat-label-md mb-2">
            Impact on {{ selectedAgent?.name }}
          </p>
          <div class="flex items-center justify-between text-sm py-2 border-b border-default">
            <span>Power</span>
            <span
              class="font-semibold"
              :class="(compareAfter?.power ?? 0) > (compareBefore?.power ?? 0) ? 'text-success' : (compareAfter?.power ?? 0) < (compareBefore?.power ?? 0) ? 'text-error' : 'text-muted'"
            >
              {{ compareBefore?.power ?? 0 }} → {{ compareAfter?.power ?? 0 }}
            </span>
          </div>
          <div
            v-for="row in compareDeltaRows"
            :key="row.label"
            class="flex items-center justify-between text-sm py-2 border-b border-default last:border-none"
          >
            <span>{{ row.label }}</span>
            <span
              class="font-semibold"
              :class="row.up ? 'text-success' : row.down ? 'text-error' : 'text-muted'"
            >
              {{ row.beforeText }} → {{ row.afterText }}
            </span>
          </div>

          <div class="flex items-center justify-between gap-3 mt-5">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="compareItemId = null"
            />
            <UButton
              color="primary"
              label="Confirm Swap"
              :loading="equipping"
              @click="audio.playSfx('click'); confirmSwap()"
            />
          </div>
        </div>
      </HackFrame>
    </template>
  </UModal>
</template>
