<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, CLASS_LABEL, CLASS_ICON, CLASS_COLOR,
  SLOT_ICON, SLOT_LABEL, SLOT_COLOR,
  RARITY_ORDER, xpToNextLevel, AGENT_MAX_LEVEL, MOD_LABEL, formatModValue, formatPct, itemSellPrice,
  AGENT_TRAIT_LABEL, AGENT_TRAIT_COUNT, AGENT_TRAIT_RANGES,
  type HackRarity, type AgentClass, type ItemSlot, type ItemMod, type AgentTrait, type AgentTraitType,
} from '#shared/utils/hack-config'

// Combined stats: traits + equipped item mods, summed by display category
function agentCombinedStats(agent: any) {
  type Stat = { label: string; value: number; fmt: (v: number) => string }
  const map = new Map<string, Stat>()

  function add(key: string, label: string, value: number, fmt: (v: number) => string) {
    const s = map.get(key)
    if (s) s.value += value
    else map.set(key, { label, value, fmt })
  }

  for (const t of (agent.traits ?? []) as AgentTrait[]) {
    if (t.type === 'speed_percent')  add('speed',   'Op Speed',     t.value, v => `+${formatPct(v)}%`)
    if (t.type === 'loot_percent')   add('loot',    'Loot',         t.value, v => `+${formatPct(v)}%`)
    if (t.type === 'gem_chance')     add('gem',     'Gem Chance',   t.value, v => `+${(v * 100).toFixed(1)}%`)
    if (t.type === 'xp_boost')       add('xp',      'XP Gain',      t.value, v => `+${Math.round(v)}%`)
    if (t.type === 'power_flat')     add('power',   'Power',        t.value, v => `+${Math.round(v)}`)
    if (t.type === 'power_percent')  add('powerpct','Power %',       t.value, v => `+${Math.round(v)}%`)
    if (t.type === 'gem_bonus')      add('gembonus','Bonus Gems',    t.value, v => `+${Math.round(v)} gems`)
  }

  for (const slot of ['tool', 'software', 'hardware'] as ItemSlot[]) {
    const item = agent.gear?.[slot]
    if (!item) continue
    for (const m of (item.mods ?? []) as ItemMod[]) {
      if (m.type === 'speed_percent')      add('speed',  'Op Speed',    m.value, v => `+${formatPct(v)}%`)
      if (m.type === 'loot_percent')       add('loot',   'Loot',        m.value, v => `+${formatPct(v)}%`)
      if (m.type === 'gem_chance')         add('gem',    'Gem Chance',  m.value, v => `+${(v * 100).toFixed(1)}%`)
      if (m.type === 'xp_flat')            add('xpflat', 'XP per Op',  m.value, v => `+${Math.round(v)} XP`)
      if (m.type === 'power_flat')         add('power',  'Power',       m.value, v => `+${Math.round(v)}`)
      if (m.type === 'item_chance')        add('itemfind','Item Find',  m.value, v => `+${(v * 100).toFixed(1)}%`)
      if (m.type === 'gem_bonus')          add('gembonus','Bonus Gems', m.value, v => `+${Math.round(v)} gems`)
    }
  }

  return Array.from(map.values()).filter(s => s.value > 0)
}

function formatTraitRange(type: AgentTraitType): string {
  const r = AGENT_TRAIT_RANGES[type]
  if (type === 'gem_chance') return `+${(r.min * 100).toFixed(1)}–${(r.max * 100).toFixed(1)}%`
  if (type === 'gem_bonus') return `+${r.min}–${r.max} gems`
  if (type === 'power_flat') return `+${r.min}–${r.max}`
  return `+${r.min}–${r.max}%`
}

const { fetchSession, user } = useAuth()
const gems = computed(() => user.value?.gems ?? 0)
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()

// ── Inventory sidebar ──────────────────────────────────────────────
const mobileItemsOpen = ref(false)
const selectedItemId = ref<string | null>(null)
const selectedItem = computed(() => state.value?.items.find(i => i.id === selectedItemId.value) ?? null)

function selectItem(id: string) {
  selectedItemId.value = selectedItemId.value === id ? null : id
}

// Inventory sorting
const sortOptions = [
  { value: 'value', label: 'Value' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'type', label: 'Type' },
] as const
const sortBy = ref<'value' | 'rarity' | 'type'>('rarity')
const sortDir = ref<'desc' | 'asc'>('desc')

const sortedItems = computed(() => {
  const items = [...(state.value?.items ?? [])]
  const dir = sortDir.value === 'asc' ? 1 : -1
  items.sort((a, b) => {
    let cmp = 0
    if (sortBy.value === 'value') cmp = itemSellPrice(a.rarity, a.itemLevel) - itemSellPrice(b.rarity, b.itemLevel)
    else if (sortBy.value === 'rarity') cmp = RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
    else cmp = a.slot.localeCompare(b.slot)
    if (cmp === 0) cmp = itemSellPrice(a.rarity, a.itemLevel) - itemSellPrice(b.rarity, b.itemLevel)
    return cmp * dir
  })
  return items
})

const equipping = ref(false)
async function equipTo(itemId: string, agentId: string | null) {
  equipping.value = true
  try {
    await $fetch('/api/hack/items/equip', { method: 'POST', body: { itemId, agentId } })
    toast.add({ title: agentId ? 'Item equipped' : 'Item unequipped', color: 'success' })
    selectedItemId.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Failed', color: 'error' })
  } finally { equipping.value = false }
}

// Fire agent
const firing = ref<string | null>(null)
async function fireAgent(agentId: string, name: string) {
  firing.value = agentId
  try {
    await $fetch('/api/hack/agents/fire', { method: 'POST', body: { agentId } })
    toast.add({ title: `${name} dismissed`, color: 'neutral' })
    if (storageAgentId.value === agentId) storageAgentId.value = null
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Cannot fire agent', color: 'error' })
  } finally { firing.value = null }
}

const selling = ref<string | null>(null)
async function sellItem(itemId: string) {
  selling.value = itemId
  try {
    const res = await $fetch('/api/hack/items/sell', { method: 'POST', body: { itemId } })
    toast.add({ title: `Sold for $${formatNumber(res.price, true)}`, color: 'success' })
    selectedItemId.value = null
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Sell failed', color: 'error' })
  } finally { selling.value = null }
}

// ── Recruit ────────────────────────────────────────────────────────
const recruiting = ref<string | null>(null)
const lastRecruit = ref<{ name: string; rarity: string; rarityLabel: string } | null>(null)

async function recruit(tierId: string) {
  recruiting.value = tierId
  lastRecruit.value = null
  try {
    const res = await $fetch('/api/hack/recruit', { method: 'POST', body: { tierId } })
    lastRecruit.value = { name: res.agent!.name, rarity: res.rarity, rarityLabel: res.rarityLabel }
    toast.add({
      title: `${res.rarityLabel} recruited!`,
      description: res.active
        ? `${res.agent!.name} joined your active roster.`
        : `${res.agent!.name} was sent to storage — activate them when a slot frees up.`,
      color: 'success',
    })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Recruit failed', color: 'error' })
  } finally { recruiting.value = null }
}

// ── Activate / store agents ─────────────────────────────────────────
const togglingActive = ref<string | null>(null)
const activeFull = computed(() =>
  !!state.value && state.value.agents.length >= state.value.rosterSlots
)

async function setActive(agentId: string, active: boolean) {
  togglingActive.value = agentId
  try {
    await $fetch('/api/hack/agents/active', { method: 'POST', body: { agentId, active } })
    toast.add({ title: active ? 'Agent activated' : 'Agent moved to storage', color: active ? 'success' : 'neutral' })
    storageAgentId.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Failed', color: 'error' })
  } finally { togglingActive.value = null }
}

// Storage detail modal — clicking a stored agent opens its card
const storageAgentId = ref<string | null>(null)
const storageAgent = computed(() =>
  state.value?.storedAgents.find(a => a.id === storageAgentId.value) ?? null
)
const storageModalOpen = computed({
  get: () => storageAgentId.value !== null,
  set: (v: boolean) => { if (!v) storageAgentId.value = null },
})

const expanding = ref(false)
async function expandRoster() {
  expanding.value = true
  try {
    await $fetch('/api/hack/roster/expand', { method: 'POST' })
    toast.add({ title: 'Roster expanded', color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Failed', color: 'error' })
  } finally { expanding.value = false }
}

// ── Helpers ────────────────────────────────────────────────────────
const busyAgentIds = computed(() =>
  new Set(state.value?.activeOps.flatMap(o => o.agentIds) ?? [])
)
function xpPercent(a: { xp: number; level: number }) {
  if (a.level >= AGENT_MAX_LEVEL) return 100
  return Math.round((a.xp / xpToNextLevel(a.level)) * 100)
}
function canAfford(tier: { currency: string; cost: number }) {
  return tier.currency === 'cash' ? balance.value >= tier.cost : gems.value >= tier.cost
}

function slotItem(agent: { gear?: { tool: any; software: any; hardware: any } }, slot: ItemSlot) {
  return agent.gear?.[slot] ?? null
}
</script>

<template>
  <div class="flex h-full min-h-0">

    <!-- ── Main area ──────────────────────────────────────────────── -->
    <div class="flex-1 min-w-0 overflow-y-auto p-6 space-y-8 pb-12">
      <!-- Header -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 class="text-2xl font-bold">Agents</h1>
          <p class="text-sm text-muted mt-0.5">Manage your crew. Select an item from the sidebar to equip it.</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <div v-if="state" class="px-3 py-2 rounded-lg bg-elevated border border-default text-sm font-medium flex items-center gap-2">
            <span>{{ state.agents.length }}/{{ state.rosterSlots }} active</span>
            <span class="text-muted">·</span>
            <span class="text-muted">{{ state.totalAgents }}/{{ state.maxAgents }} owned</span>
          </div>
          <UButton
            v-if="state && state.rosterSlots < state.maxRosterSlots"
            color="neutral" variant="outline" icon="i-lucide-user-plus"
            :loading="expanding" :disabled="balance < (state.rosterExpandCost ?? Infinity)"
            @click="expandRoster"
          >
            Add Slot — ${{ formatNumber(state.rosterExpandCost ?? 0, true) }}
          </UButton>
          <UButton
            icon="i-lucide-package" label="Items" variant="soft" color="neutral" size="sm"
            class="lg:hidden" @click="mobileItemsOpen = true"
          />
        </div>
      </div>

      <div v-if="!state" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <USkeleton v-for="i in 2" :key="i" class="h-64 rounded-xl" />
      </div>

      <template v-else>
        <!-- Agent Roster -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UCard v-for="agent in state.agents" :key="agent.id">
            <!-- Agent header -->
            <div class="flex items-start gap-3 mb-4">
              <div class="size-12 rounded-xl flex items-center justify-center shrink-0 ring-1"
                :class="[CLASS_COLOR[agent.class as AgentClass].bg, CLASS_COLOR[agent.class as AgentClass].ring]">
                <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-6"
                  :class="CLASS_COLOR[agent.class as AgentClass].text" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-bold text-lg">{{ agent.name }}</span>
                  <UBadge :color="RARITY_COLOR[agent.rarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[agent.rarity as HackRarity]" />
                  <UBadge v-if="busyAgentIds.has(agent.id)" color="primary" variant="subtle" label="On Op" />
                </div>
                <!-- Spec chip — distinct color per class -->
                <span class="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-md border text-xs font-medium"
                  :class="[CLASS_COLOR[agent.class as AgentClass].bg, CLASS_COLOR[agent.class as AgentClass].border, CLASS_COLOR[agent.class as AgentClass].text]">
                  <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-3" />
                  {{ CLASS_LABEL[agent.class as AgentClass] }}
                </span>
              </div>
              <div class="flex flex-col items-end gap-2 shrink-0">
                <div class="text-right">
                  <p class="text-sm text-muted">Power</p>
                  <p class="text-2xl font-bold text-primary">{{ agent.power }}</p>
                </div>
                <div class="flex items-center gap-1">
                  <UButton
                    size="xs" color="neutral" variant="ghost" icon="i-lucide-archive"
                    label="Store" :loading="togglingActive === agent.id"
                    :disabled="busyAgentIds.has(agent.id)"
                    @click="setActive(agent.id, false)"
                  />
                  <UButton
                    size="xs" color="error" variant="ghost" icon="i-lucide-user-x"
                    label="Fire" :loading="firing === agent.id"
                    :disabled="busyAgentIds.has(agent.id)"
                    @click="fireAgent(agent.id, agent.name)"
                  />
                </div>
              </div>
            </div>

            <!-- XP bar -->
            <div class="mb-4">
              <div class="flex justify-between text-sm mb-1.5">
                <span class="font-medium">Lv {{ agent.level }}<span v-if="agent.level < AGENT_MAX_LEVEL" class="text-muted"> / {{ AGENT_MAX_LEVEL }}</span></span>
                <span v-if="agent.level < AGENT_MAX_LEVEL" class="text-muted">{{ agent.xp }} / {{ xpToNextLevel(agent.level) }} XP</span>
                <span v-else class="text-success font-semibold">Max Level</span>
              </div>
              <div class="h-2 rounded-full bg-elevated overflow-hidden">
                <div class="h-full rounded-full bg-primary transition-all duration-500" :style="{ width: `${xpPercent(agent)}%` }" />
              </div>
            </div>

            <!-- Combined stats (traits + gear) -->
            <div class="mb-4 p-3 rounded-lg bg-elevated space-y-1.5">
              <p class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Total Bonuses</p>
              <template v-if="agentCombinedStats(agent).length">
                <div v-for="s in agentCombinedStats(agent)" :key="s.label"
                  class="flex items-center justify-between text-sm">
                  <span class="text-muted">{{ s.label }}</span>
                  <span class="font-bold text-primary">{{ s.fmt(s.value) }}</span>
                </div>
              </template>
              <p v-else class="text-sm text-muted italic">No traits yet — fire and re-recruit for a better agent.</p>
            </div>

            <!-- Gear slots -->
            <div class="space-y-2">
              <div v-for="slot in (['tool', 'software', 'hardware'] as ItemSlot[])" :key="slot">
                <div v-if="slotItem(agent, slot)" class="flex items-start gap-3 p-3 rounded-lg border border-default">
                  <div class="size-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                    :class="[SLOT_COLOR[slot].bg, SLOT_COLOR[slot].text]">
                    <UIcon :name="SLOT_ICON[slot]" class="size-4" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap mb-1">
                      <span class="font-medium text-sm">{{ slotItem(agent, slot)!.name }}</span>
                      <UBadge size="xs" :color="RARITY_COLOR[slotItem(agent, slot)!.rarity as HackRarity]" variant="subtle"
                        :label="RARITY_LABEL[slotItem(agent, slot)!.rarity as HackRarity]" />
                    </div>
                    <div class="flex flex-wrap gap-x-3">
                      <span v-for="m in (slotItem(agent, slot)!.mods as ItemMod[])" :key="m.type" class="text-sm font-medium text-primary">
                        {{ MOD_LABEL[m.type] }} {{ formatModValue(m.type, m.value) }}
                      </span>
                    </div>
                  </div>
                  <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-link-slash"
                    label="Unequip" :loading="equipping" @click="equipTo(slotItem(agent, slot)!.id, null)" />
                </div>

                <!-- Empty slot — clickable if matching item selected -->
                <div v-else
                  class="flex items-center gap-3 p-3 rounded-lg border transition-colors"
                  :class="selectedItem?.slot === slot
                    ? 'border-primary bg-primary/10 cursor-pointer'
                    : 'border-dashed border-default'"
                  @click="selectedItem?.slot === slot && equipTo(selectedItem.id, agent.id)"
                >
                  <UIcon :name="SLOT_ICON[slot]" class="size-4 shrink-0" :class="selectedItem?.slot === slot ? 'text-primary' : SLOT_COLOR[slot].text + ' opacity-60'" />
                  <span v-if="selectedItem?.slot === slot" class="text-sm text-primary font-medium">
                    Equip {{ selectedItem.name }} here
                  </span>
                  <span v-else class="text-sm text-muted">{{ SLOT_LABEL[slot] }} — empty</span>
                </div>
              </div>
            </div>
          </UCard>

          <!-- Empty active slots -->
          <div v-for="i in (state.rosterSlots - state.agents.length)" :key="`empty-${i}`"
            class="rounded-xl border-2 border-dashed border-default flex flex-col items-center justify-center h-36 gap-1 text-muted">
            <UIcon name="i-lucide-user-plus" class="size-6 opacity-30" />
            <span class="text-sm">{{ state.storedAgents.length ? 'Empty active slot — activate from storage' : 'Empty active slot — recruit below' }}</span>
          </div>
        </div>

        <!-- Storage -->
        <div v-if="state.storedAgents.length" class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-base text-muted uppercase tracking-wide flex items-center gap-2">
              <UIcon name="i-lucide-archive" class="size-4" /> Storage
            </h2>
            <p class="text-sm text-muted">Inactive agents — don't count toward power. Click for details.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div
              v-for="agent in state.storedAgents" :key="agent.id"
              class="flex items-center gap-3 p-3 rounded-lg border border-default hover:border-primary/50 cursor-pointer transition-colors"
              @click="storageAgentId = agent.id"
            >
              <div class="size-9 rounded-lg flex items-center justify-center shrink-0 ring-1"
                :class="[CLASS_COLOR[agent.class as AgentClass].bg, CLASS_COLOR[agent.class as AgentClass].ring]">
                <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-5" :class="CLASS_COLOR[agent.class as AgentClass].text" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium truncate">{{ agent.name }}</span>
                  <UBadge size="xs" :color="RARITY_COLOR[agent.rarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[agent.rarity as HackRarity]" />
                </div>
                <span class="text-xs text-muted">Lv {{ agent.level }} · {{ CLASS_LABEL[agent.class as AgentClass] }}</span>
              </div>
              <div class="text-right shrink-0">
                <p class="text-xs text-muted">Power</p>
                <p class="font-bold text-primary leading-none">{{ agent.power }}</p>
              </div>
              <UButton
                size="xs" color="primary" variant="soft" icon="i-lucide-arrow-up-circle"
                label="Activate" :loading="togglingActive === agent.id" :disabled="activeFull"
                @click.stop="setActive(agent.id, true)"
              />
            </div>
          </div>
          <p v-if="activeFull" class="text-xs text-muted">Active roster is full — store or fire an active agent (or add a slot) to activate more.</p>
        </div>

        <!-- Recruit -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-base text-muted uppercase tracking-wide">Recruit</h2>
            <p class="text-sm text-muted">
              <template v-if="state.totalAgents >= state.maxAgents" class="text-warning">Storage full ({{ state.maxAgents }}) — fire an agent to recruit</template>
              <template v-else>Fixed price per tier · higher tiers, better odds</template>
            </p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <UCard v-for="tier in state.agentPullTiers" :key="tier.id" class="flex flex-col">
              <div class="flex items-start gap-3 mb-4">
                <div class="size-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <UIcon name="i-lucide-user-search" class="size-6 text-primary" />
                </div>
                <div>
                  <p class="font-bold text-base">{{ tier.name }}</p>
                  <p class="text-sm text-muted">{{ tier.description }}</p>
                </div>
              </div>

              <!-- Rarity odds + trait count -->
              <div class="space-y-1.5 mb-3">
                <div v-for="r in RARITY_ORDER.filter(r => tier.weights[r] > 0)" :key="r"
                  class="flex items-center justify-between text-sm">
                  <div class="flex items-center gap-2">
                    <UBadge :color="RARITY_COLOR[r]" variant="subtle" :label="RARITY_LABEL[r]" />
                    <span class="text-muted">{{ AGENT_TRAIT_COUNT[r] }} trait{{ AGENT_TRAIT_COUNT[r] > 1 ? 's' : '' }}</span>
                  </div>
                  <span class="font-medium">{{ Math.round(tier.weights[r] / Object.values(tier.weights).reduce((a, b) => a + b, 0) * 100) }}%</span>
                </div>
              </div>

              <!-- Possible trait ranges -->
              <div class="mb-4 p-3 rounded-lg bg-elevated space-y-1 flex-1">
                <p class="text-sm font-semibold text-muted mb-1.5">Possible traits:</p>
                <div v-for="(_, traitType) in AGENT_TRAIT_RANGES" :key="traitType"
                  class="flex items-center justify-between text-sm">
                  <span class="text-muted">{{ AGENT_TRAIT_LABEL[traitType as AgentTraitType] }}</span>
                  <span class="font-medium text-default">{{ formatTraitRange(traitType as AgentTraitType) }}</span>
                </div>
              </div>

              <UButton block :loading="recruiting === tier.id"
                :disabled="!canAfford(tier) || state.totalAgents >= state.maxAgents"
                @click="recruit(tier.id)">
                Pull
                <template #trailing>
                  <span class="text-sm opacity-80 flex items-center gap-1">
                    <template v-if="tier.currency === 'cash'">${{ formatNumber(tier.cost, true) }}</template>
                    <template v-else>{{ tier.cost }} <UIcon name="i-lucide-gem" class="size-4 text-cyan-400" /></template>
                  </span>
                </template>
              </UButton>
            </UCard>
          </div>
        </div>

        <UAlert v-if="lastRecruit" :color="RARITY_COLOR[lastRecruit.rarity as HackRarity]" variant="subtle"
          :title="`${lastRecruit.rarityLabel} agent recruited`" :description="`${lastRecruit.name} joined your crew.`"
          icon="i-lucide-user-check"
          :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost', onClick: () => lastRecruit = null }" />
      </template>
    </div>

    <!-- ── Inventory sidebar (desktop) ───────────────────────────── -->
    <div class="hidden lg:flex flex-col w-80 shrink-0 border-l border-default overflow-y-auto">
      <div class="p-4 space-y-3 pb-12">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-base">Inventory</h2>
          <span class="text-sm text-muted">{{ state?.inventoryCount ?? 0 }}/{{ state?.maxInventorySlots ?? 30 }}</span>
        </div>

        <!-- Sort controls -->
        <div v-if="state?.items.length" class="flex items-center gap-1">
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

        <div v-if="!state" class="space-y-2">
          <USkeleton v-for="i in 3" :key="i" class="h-20 rounded-lg" />
        </div>
        <div v-else-if="!state.items.length" class="text-sm text-muted text-center py-8">
          <UIcon name="i-lucide-package-open" class="size-8 mx-auto mb-2 opacity-30" />
          No items yet — buy pulls on the Items tab.
        </div>
        <div v-else class="space-y-2">
          <HackInventoryItem
            v-for="item in sortedItems" :key="item.id"
            :item="item" :selected="selectedItemId === item.id"
            @select="selectItem(item.id)"
          >
            <template #actions>
              <p class="text-sm text-muted">Click an empty <span class="capitalize">{{ item.slot }}</span> slot on an agent to equip.</p>
              <UButton block size="sm" color="neutral" variant="subtle"
                icon="i-lucide-dollar-sign" :loading="selling === item.id"
                :label="`Sell $${formatNumber(itemSellPrice(item.rarity, item.itemLevel), true)}`"
                @click="sellItem(item.id)" />
            </template>
          </HackInventoryItem>
        </div>
      </div>
    </div>
  </div>

  <!-- Mobile slideover -->
  <USlideover v-model:open="mobileItemsOpen" title="Inventory" side="right" class="lg:hidden">
    <template #body>
      <div class="p-4 space-y-2 overflow-y-auto h-full">
        <div v-if="!state?.items.length" class="text-sm text-muted text-center py-8">No items yet.</div>
        <HackInventoryItem
          v-else v-for="item in sortedItems" :key="item.id"
          :item="item" :selected="selectedItemId === item.id"
          @select="selectItem(item.id)"
        >
          <template #actions>
            <p class="text-sm text-muted">Close this panel and tap an empty <span class="capitalize">{{ item.slot }}</span> slot to equip.</p>
            <UButton block size="sm" color="neutral" variant="subtle"
              icon="i-lucide-dollar-sign" :loading="selling === item.id"
              :label="`Sell $${formatNumber(itemSellPrice(item.rarity, item.itemLevel), true)}`"
              @click="sellItem(item.id)" />
          </template>
        </HackInventoryItem>
      </div>
    </template>
  </USlideover>

  <!-- Stored agent detail -->
  <UModal v-model:open="storageModalOpen" :title="storageAgent?.name ?? 'Agent'" description="Stored agent — activate to add them to your roster.">
    <template v-if="storageAgent" #body>
      <div class="space-y-4">
        <!-- Header -->
        <div class="flex items-start gap-3">
          <div class="size-12 rounded-xl flex items-center justify-center shrink-0 ring-1"
            :class="[CLASS_COLOR[storageAgent.class as AgentClass].bg, CLASS_COLOR[storageAgent.class as AgentClass].ring]">
            <UIcon :name="CLASS_ICON[storageAgent.class as AgentClass]" class="size-6" :class="CLASS_COLOR[storageAgent.class as AgentClass].text" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-lg">{{ storageAgent.name }}</span>
              <UBadge :color="RARITY_COLOR[storageAgent.rarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[storageAgent.rarity as HackRarity]" />
            </div>
            <span class="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-md border text-xs font-medium"
              :class="[CLASS_COLOR[storageAgent.class as AgentClass].bg, CLASS_COLOR[storageAgent.class as AgentClass].border, CLASS_COLOR[storageAgent.class as AgentClass].text]">
              <UIcon :name="CLASS_ICON[storageAgent.class as AgentClass]" class="size-3" />
              {{ CLASS_LABEL[storageAgent.class as AgentClass] }}
            </span>
          </div>
          <div class="text-right shrink-0">
            <p class="text-sm text-muted">Power</p>
            <p class="text-2xl font-bold text-primary">{{ storageAgent.power }}</p>
          </div>
        </div>

        <!-- XP bar -->
        <div>
          <div class="flex justify-between text-sm mb-1.5">
            <span class="font-medium">Lv {{ storageAgent.level }}<span v-if="storageAgent.level < AGENT_MAX_LEVEL" class="text-muted"> / {{ AGENT_MAX_LEVEL }}</span></span>
            <span v-if="storageAgent.level < AGENT_MAX_LEVEL" class="text-muted">{{ storageAgent.xp }} / {{ xpToNextLevel(storageAgent.level) }} XP</span>
            <span v-else class="text-success font-semibold">Max Level</span>
          </div>
          <div class="h-2 rounded-full bg-elevated overflow-hidden">
            <div class="h-full rounded-full bg-primary transition-all duration-500" :style="{ width: `${xpPercent(storageAgent)}%` }" />
          </div>
        </div>

        <!-- Total bonuses -->
        <div class="p-3 rounded-lg bg-elevated space-y-1.5">
          <p class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Total Bonuses</p>
          <template v-if="agentCombinedStats(storageAgent).length">
            <div v-for="s in agentCombinedStats(storageAgent)" :key="s.label" class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ s.label }}</span>
              <span class="font-bold text-primary">{{ s.fmt(s.value) }}</span>
            </div>
          </template>
          <p v-else class="text-sm text-muted italic">No traits.</p>
        </div>

        <!-- Equipped gear (read-only) -->
        <div class="space-y-2">
          <div v-for="slot in (['tool', 'software', 'hardware'] as ItemSlot[])" :key="slot">
            <div v-if="slotItem(storageAgent, slot)" class="flex items-start gap-3 p-3 rounded-lg border border-default">
              <div class="size-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                :class="[SLOT_COLOR[slot].bg, SLOT_COLOR[slot].text]">
                <UIcon :name="SLOT_ICON[slot]" class="size-4" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap mb-1">
                  <span class="font-medium text-sm">{{ slotItem(storageAgent, slot)!.name }}</span>
                  <UBadge size="xs" :color="RARITY_COLOR[slotItem(storageAgent, slot)!.rarity as HackRarity]" variant="subtle"
                    :label="RARITY_LABEL[slotItem(storageAgent, slot)!.rarity as HackRarity]" />
                </div>
                <div class="flex flex-wrap gap-x-3">
                  <span v-for="m in (slotItem(storageAgent, slot)!.mods as ItemMod[])" :key="m.type" class="text-sm font-medium text-primary">
                    {{ MOD_LABEL[m.type] }} {{ formatModValue(m.type, m.value) }}
                  </span>
                </div>
              </div>
              <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-link-slash"
                label="Unequip" :loading="equipping" @click="equipTo(slotItem(storageAgent, slot)!.id, null)" />
            </div>
            <div v-else class="flex items-center gap-3 p-3 rounded-lg border border-dashed border-default">
              <UIcon :name="SLOT_ICON[slot]" class="size-4 shrink-0" :class="SLOT_COLOR[slot].text + ' opacity-60'" />
              <span class="text-sm text-muted">{{ SLOT_LABEL[slot] }} — empty</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3 w-full">
        <UButton color="error" variant="ghost" icon="i-lucide-user-x" label="Fire"
          :loading="firing === storageAgent?.id" @click="storageAgent && fireAgent(storageAgent.id, storageAgent.name)" />
        <UButton color="primary" icon="i-lucide-arrow-up-circle" label="Activate"
          :loading="togglingActive === storageAgent?.id" :disabled="activeFull"
          @click="storageAgent && setActive(storageAgent.id, true)" />
      </div>
    </template>
  </UModal>
</template>
