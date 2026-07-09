<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_STYLE, CLASS_LABEL, CLASS_ICON, CLASS_PASSIVE,
  SLOT_ICON, SLOT_LABEL,
  RARITY_ORDER, xpToNextLevel, AGENT_MAX_LEVEL, MOD_LABEL, formatModValue, itemSellPrice,
  agentBonusStats,
  type HackRarity, type AgentClass, type ItemSlot, type ItemMod,
} from '#shared/utils/hack-config'

// Total bonuses for a single agent (class passive + traits + gear), summed by category.
const agentCombinedStats = (agent: any) => agentBonusStats([agent])

const { fetchSession, user } = useAuth()
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
    if (sortBy.value === 'value') cmp = itemSellPrice(a.rarity) - itemSellPrice(b.rarity)
    else if (sortBy.value === 'rarity') cmp = RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
    else cmp = a.slot.localeCompare(b.slot)
    if (cmp === 0) cmp = itemSellPrice(a.rarity) - itemSellPrice(b.rarity)
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

// Fire agent — the button arms a confirm first; a second click within the
// window actually fires. `fireConfirmId` tracks which agent is armed.
const firing = ref<string | null>(null)
const fireConfirmId = ref<string | null>(null)
let fireConfirmTimer: ReturnType<typeof setTimeout> | null = null

function requestFire(agentId: string, name: string) {
  if (fireConfirmTimer) clearTimeout(fireConfirmTimer)
  if (fireConfirmId.value === agentId) {
    fireConfirmId.value = null
    fireAgent(agentId, name)
    return
  }
  fireConfirmId.value = agentId
  fireConfirmTimer = setTimeout(() => { fireConfirmId.value = null }, 3000)
}

async function fireAgent(agentId: string, name: string) {
  firing.value = agentId
  try {
    await $fetch('/api/hack/agents/fire', { method: 'POST', body: { agentId } })
    toast.add({ title: `${name} dismissed`, color: 'neutral' })
    if (detailAgentId.value === agentId) detailAgentId.value = null
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Cannot fire agent', color: 'error' })
  } finally { firing.value = null }
}

// Selling arms a confirm on the first click; a second click within the window
// actually sells. `sellConfirmId` tracks which item is armed.
const selling = ref<string | null>(null)
const sellConfirmId = ref<string | null>(null)
let sellConfirmTimer: ReturnType<typeof setTimeout> | null = null

function requestSell(itemId: string) {
  if (sellConfirmTimer) clearTimeout(sellConfirmTimer)
  if (sellConfirmId.value === itemId) {
    sellConfirmId.value = null
    sellItem(itemId)
    return
  }
  sellConfirmId.value = itemId
  sellConfirmTimer = setTimeout(() => { sellConfirmId.value = null }, 3000)
}

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
    detailAgentId.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Failed', color: 'error' })
  } finally { togglingActive.value = null }
}

// Agent detail modal, opened by clicking a stored agent. Looks the agent up
// in either roster by id.
const detailAgentId = ref<string | null>(null)
const detailAgent = computed(() =>
  state.value?.agents.find(a => a.id === detailAgentId.value)
  ?? state.value?.storedAgents.find(a => a.id === detailAgentId.value)
  ?? null
)
const detailAgentActive = computed(() =>
  !!detailAgent.value && !!state.value?.agents.some(a => a.id === detailAgentId.value)
)
const detailModalOpen = computed({
  get: () => detailAgentId.value !== null,
  set: (v: boolean) => { if (!v) detailAgentId.value = null },
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
        <section class="space-y-3">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <h2 class="font-semibold text-base text-muted uppercase tracking-wide flex items-center gap-2">
              <UIcon name="i-lucide-users" class="size-4" /> Active Roster
            </h2>
            <p class="text-sm text-muted">Only active agents can deploy on ops. Click an empty gear slot to equip the selected item.</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UCard v-for="agent in state.agents" :key="agent.id">
              <!-- Agent header -->
              <div class="flex items-start gap-3 mb-4">
                <!-- Avatar: rarity-tinted frame holding the class icon -->
                <div class="size-12 rounded-xl flex items-center justify-center shrink-0 ring-1"
                  :class="[RARITY_STYLE[agent.rarity as HackRarity].bg, RARITY_STYLE[agent.rarity as HackRarity].ring, RARITY_STYLE[agent.rarity as HackRarity].text]">
                  <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-6" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-lg">{{ agent.name }}</span>
                    <UBadge :color="RARITY_COLOR[agent.rarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[agent.rarity as HackRarity]" />
                    <UBadge v-if="busyAgentIds.has(agent.id)" color="primary" variant="subtle" label="On Op" />
                  </div>
                  <!-- Spec — icon-led + neutral, with the class passive spelled out -->
                  <div class="flex items-center gap-1.5 mt-1 text-xs">
                    <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-3.5 text-muted" />
                    <span class="font-medium">{{ CLASS_LABEL[agent.class as AgentClass] }}</span>
                    <span class="text-muted">· {{ CLASS_PASSIVE[agent.class as AgentClass].label }}</span>
                  </div>
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
                      size="xs" color="error" icon="i-lucide-user-x"
                      :variant="fireConfirmId === agent.id ? 'soft' : 'ghost'"
                      :label="fireConfirmId === agent.id ? 'Sure?' : 'Fire'"
                      :loading="firing === agent.id"
                      :disabled="busyAgentIds.has(agent.id)"
                      @click="requestFire(agent.id, agent.name)"
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
              <div class="mb-4 p-3 rounded-lg bg-elevated">
                <p class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Total Bonuses</p>
                <div v-if="agentCombinedStats(agent).length" class="grid grid-cols-2 gap-x-6 gap-y-1">
                  <div v-for="s in agentCombinedStats(agent)" :key="s.label"
                    class="flex items-center justify-between text-sm">
                    <span class="text-muted">{{ s.label }}</span>
                    <span class="font-bold text-primary">{{ s.fmt(s.value) }}</span>
                  </div>
                </div>
                <p v-else class="text-sm text-muted italic">No traits yet — fire and re-recruit for a better agent.</p>
              </div>

              <!-- Gear slots -->
              <div class="space-y-2">
                <div v-for="slot in (['tool', 'software', 'hardware'] as ItemSlot[])" :key="slot">
                  <div v-if="slotItem(agent, slot)" class="flex items-start gap-3 p-3 rounded-lg border border-default">
                    <div class="size-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 bg-elevated text-muted">
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
                    <UIcon :name="SLOT_ICON[slot]" class="size-4 shrink-0" :class="selectedItem?.slot === slot ? 'text-primary' : 'text-muted opacity-60'" />
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
              <span class="text-sm">{{ state.storedAgents.length ? 'Empty active slot — activate from storage' : 'Empty active slot — recruit from the Black Market' }}</span>
            </div>
          </div>
        </section>

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
              @click="detailAgentId = agent.id"
            >
              <div class="size-9 rounded-lg flex items-center justify-center shrink-0 ring-1"
                :class="[RARITY_STYLE[agent.rarity as HackRarity].bg, RARITY_STYLE[agent.rarity as HackRarity].ring, RARITY_STYLE[agent.rarity as HackRarity].text]">
                <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-5" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium truncate">{{ agent.name }}</span>
                  <UBadge size="xs" :color="RARITY_COLOR[agent.rarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[agent.rarity as HackRarity]" />
                </div>
                <span class="text-xs text-muted flex items-center gap-1">
                  <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-3" />
                  Lv {{ agent.level }} · {{ CLASS_LABEL[agent.class as AgentClass] }}
                </span>
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

        <!-- Recruit — moved to the Black Market tab (Contacts section) -->
        <UButton
          block
          size="lg"
          color="neutral"
          variant="outline"
          to="/hack/market"
          icon="i-lucide-store"
          label="Need more agents? Visit the Black Market"
        />
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
              <UButton block size="sm" icon="i-lucide-dollar-sign"
                :color="sellConfirmId === item.id ? 'error' : 'neutral'"
                :variant="sellConfirmId === item.id ? 'solid' : 'subtle'"
                :loading="selling === item.id"
                :label="sellConfirmId === item.id ? 'Confirm sell?' : `Sell $${formatNumber(itemSellPrice(item.rarity), true)}`"
                @click="requestSell(item.id)" />
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
              :label="`Sell $${formatNumber(itemSellPrice(item.rarity), true)}`"
              @click="sellItem(item.id)" />
          </template>
        </HackInventoryItem>
      </div>
    </template>
  </USlideover>

  <!-- Agent detail — click a stored agent to view/manage them -->
  <UModal v-model:open="detailModalOpen" :title="detailAgent?.name ?? 'Agent'"
    :description="detailAgentActive ? 'Active on your roster.' : 'In storage — activate to add them to your roster.'">
    <template v-if="detailAgent" #body>
      <div class="space-y-4">
        <!-- Header -->
        <div class="flex items-start gap-3">
          <div class="size-12 rounded-xl flex items-center justify-center shrink-0 ring-1"
            :class="[RARITY_STYLE[detailAgent.rarity as HackRarity].bg, RARITY_STYLE[detailAgent.rarity as HackRarity].ring, RARITY_STYLE[detailAgent.rarity as HackRarity].text]">
            <UIcon :name="CLASS_ICON[detailAgent.class as AgentClass]" class="size-6" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-lg">{{ detailAgent.name }}</span>
              <UBadge :color="RARITY_COLOR[detailAgent.rarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[detailAgent.rarity as HackRarity]" />
            </div>
            <div class="flex items-center gap-1.5 mt-1 text-xs">
              <UIcon :name="CLASS_ICON[detailAgent.class as AgentClass]" class="size-3.5 text-muted" />
              <span class="font-medium">{{ CLASS_LABEL[detailAgent.class as AgentClass] }}</span>
              <span class="text-muted">· {{ CLASS_PASSIVE[detailAgent.class as AgentClass].label }}</span>
            </div>
          </div>
          <div class="text-right shrink-0">
            <p class="text-sm text-muted">Power</p>
            <p class="text-2xl font-bold text-primary">{{ detailAgent.power }}</p>
          </div>
        </div>

        <!-- XP bar -->
        <div>
          <div class="flex justify-between text-sm mb-1.5">
            <span class="font-medium">Lv {{ detailAgent.level }}<span v-if="detailAgent.level < AGENT_MAX_LEVEL" class="text-muted"> / {{ AGENT_MAX_LEVEL }}</span></span>
            <span v-if="detailAgent.level < AGENT_MAX_LEVEL" class="text-muted">{{ detailAgent.xp }} / {{ xpToNextLevel(detailAgent.level) }} XP</span>
            <span v-else class="text-success font-semibold">Max Level</span>
          </div>
          <div class="h-2 rounded-full bg-elevated overflow-hidden">
            <div class="h-full rounded-full bg-primary transition-all duration-500" :style="{ width: `${xpPercent(detailAgent)}%` }" />
          </div>
        </div>

        <!-- Total bonuses -->
        <div class="p-3 rounded-lg bg-elevated space-y-1.5">
          <p class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Total Bonuses</p>
          <template v-if="agentCombinedStats(detailAgent).length">
            <div v-for="s in agentCombinedStats(detailAgent)" :key="s.label" class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ s.label }}</span>
              <span class="font-bold text-primary">{{ s.fmt(s.value) }}</span>
            </div>
          </template>
          <p v-else class="text-sm text-muted italic">No traits.</p>
        </div>

        <!-- Equipped gear (read-only) -->
        <div class="space-y-2">
          <div v-for="slot in (['tool', 'software', 'hardware'] as ItemSlot[])" :key="slot">
            <div v-if="slotItem(detailAgent, slot)" class="flex items-start gap-3 p-3 rounded-lg border border-default">
              <div class="size-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 bg-elevated text-muted">
                <UIcon :name="SLOT_ICON[slot]" class="size-4" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap mb-1">
                  <span class="font-medium text-sm">{{ slotItem(detailAgent, slot)!.name }}</span>
                  <UBadge size="xs" :color="RARITY_COLOR[slotItem(detailAgent, slot)!.rarity as HackRarity]" variant="subtle"
                    :label="RARITY_LABEL[slotItem(detailAgent, slot)!.rarity as HackRarity]" />
                </div>
                <div class="flex flex-wrap gap-x-3">
                  <span v-for="m in (slotItem(detailAgent, slot)!.mods as ItemMod[])" :key="m.type" class="text-sm font-medium text-primary">
                    {{ MOD_LABEL[m.type] }} {{ formatModValue(m.type, m.value) }}
                  </span>
                </div>
              </div>
              <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-link-slash"
                label="Unequip" :loading="equipping" @click="equipTo(slotItem(detailAgent, slot)!.id, null)" />
            </div>
            <div v-else class="flex items-center gap-3 p-3 rounded-lg border border-dashed border-default">
              <UIcon :name="SLOT_ICON[slot]" class="size-4 shrink-0 text-muted opacity-60" />
              <span class="text-sm text-muted">{{ SLOT_LABEL[slot] }} — empty</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3 w-full">
        <UButton color="error" icon="i-lucide-user-x"
          :variant="fireConfirmId === detailAgent?.id ? 'soft' : 'ghost'"
          :label="fireConfirmId === detailAgent?.id ? 'Sure?' : 'Fire'"
          :loading="firing === detailAgent?.id"
          :disabled="!!detailAgent && busyAgentIds.has(detailAgent.id)"
          @click="detailAgent && requestFire(detailAgent.id, detailAgent.name)" />
        <UButton v-if="detailAgentActive" color="neutral" variant="soft" icon="i-lucide-archive" label="Store"
          :loading="togglingActive === detailAgent?.id"
          :disabled="!!detailAgent && busyAgentIds.has(detailAgent.id)"
          @click="detailAgent && setActive(detailAgent.id, false)" />
        <UButton v-else color="primary" icon="i-lucide-arrow-up-circle" label="Activate"
          :loading="togglingActive === detailAgent?.id" :disabled="activeFull"
          @click="detailAgent && setActive(detailAgent.id, true)" />
      </div>
    </template>
  </UModal>
</template>
