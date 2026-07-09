<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_STYLE, CLASS_LABEL, CLASS_ICON, CLASS_PASSIVE,
  SLOT_ICON, SLOT_LABEL,
  xpToNextLevel, AGENT_MAX_LEVEL, MOD_LABEL, formatModValue,
  agentBonusStats,
  type HackRarity, type AgentClass, type ItemSlot, type ItemMod,
} from '#shared/utils/hack-config'

// Total bonuses for a single agent (class passive + traits + gear), summed by category.
const agentCombinedStats = (agent: any) => agentBonusStats([agent])

const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()

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
  <div class="p-6 space-y-8 pb-12 overflow-y-auto h-full">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-bold">Agents</h1>
        <p class="hack-eyebrow mt-1.5">// roster management — equip gear from the Loadout tab</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <div v-if="state" class="hack-frame hack-frame-tight px-3 py-2 flex items-center gap-2 text-sm">
          <span class="hack-stat-value-lg">{{ state.agents.length }}/{{ state.rosterSlots }}</span>
          <span class="text-muted">active</span>
          <span class="text-muted">·</span>
          <span class="hack-stat-value-lg">{{ state.totalAgents }}/{{ state.maxAgents }}</span>
          <span class="text-muted">owned</span>
        </div>
        <UButton
          v-if="state && state.rosterSlots < state.maxRosterSlots"
          color="neutral" variant="outline" icon="i-lucide-user-plus"
          :loading="expanding" :disabled="balance < (state.rosterExpandCost ?? Infinity)"
          @click="expandRoster"
        >
          Add Slot — ${{ formatNumber(state.rosterExpandCost ?? 0, true) }}
        </UButton>
      </div>
    </div>

    <div v-if="!state" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <USkeleton v-for="i in 2" :key="i" class="h-64 rounded-xl" />
    </div>

    <template v-else>
      <!-- Agent Roster -->
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="hack-stat-label-md flex items-center gap-2">
            <UIcon name="i-lucide-users" class="size-4" /> Active Roster
          </h2>
          <p class="text-sm text-muted">Only active agents can deploy on ops.</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <HackFrame v-for="agent in state.agents" :key="agent.id" class="p-5">
            <!-- Agent header -->
            <div class="flex items-start gap-3 mb-4">
              <!-- Portrait: rarity-tinted frame holding the class icon -->
              <div class="size-14 rounded-lg flex items-center justify-center shrink-0 ring-1"
                :class="[RARITY_STYLE[agent.rarity as HackRarity].bg, RARITY_STYLE[agent.rarity as HackRarity].ring, RARITY_STYLE[agent.rarity as HackRarity].text]">
                <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-7" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="hack-card-title-lg">{{ agent.name }}</span>
                  <UBadge :color="RARITY_COLOR[agent.rarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[agent.rarity as HackRarity]" />
                  <UBadge v-if="busyAgentIds.has(agent.id)" color="primary" variant="subtle" label="On Op" />
                </div>
                <div class="flex items-center gap-1.5 mt-1 text-xs">
                  <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-3.5 text-muted" />
                  <span class="font-medium">{{ CLASS_LABEL[agent.class as AgentClass] }}</span>
                  <span class="text-muted">· {{ CLASS_PASSIVE[agent.class as AgentClass].label }}</span>
                </div>
              </div>
              <div class="flex flex-col items-end gap-2 shrink-0">
                <div class="text-right">
                  <p class="hack-stat-label-md">Power</p>
                  <p class="font-mono text-2xl font-bold text-primary">{{ agent.power }}</p>
                </div>
                <div class="flex items-center gap-1">
                  <UButton
                    size="xs" color="primary" variant="soft" icon="i-lucide-shield-half"
                    label="Equip" :to="`/hack/loadout?agent=${agent.id}`"
                  />
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
              <div class="h-2 bg-elevated overflow-hidden">
                <div class="h-full bg-primary transition-all duration-500" :style="{ width: `${xpPercent(agent)}%` }" />
              </div>
            </div>

            <!-- Combined stats (traits + gear) -->
            <div class="mb-4">
              <p class="hack-stat-label-md mb-2">Total Bonuses</p>
              <div v-if="agentCombinedStats(agent).length" class="flex flex-wrap gap-1.5">
                <HackModChip v-for="s in agentCombinedStats(agent)" :key="s.label" :label="s.label" :value="s.fmt(s.value)" />
              </div>
              <p v-else class="text-sm text-muted italic">No traits yet — fire and re-recruit for a better agent.</p>
            </div>

            <!-- Gear slots — read-only, equip/unequip happens on the Loadout tab -->
            <div class="space-y-2">
              <div v-for="slot in (['tool', 'software', 'hardware'] as ItemSlot[])" :key="slot">
                <div v-if="slotItem(agent, slot)" class="hack-frame hack-frame-tight hack-frame-2 relative pl-4 pr-3.5 py-2.5">
                  <span class="absolute inset-y-0 left-0 w-1" :class="RARITY_STYLE[slotItem(agent, slot)!.rarity as HackRarity].bg" />
                  <div class="flex items-center justify-between gap-2 mb-1.5">
                    <span class="font-medium text-sm">{{ slotItem(agent, slot)!.name }}</span>
                    <UBadge size="xs" variant="subtle" :label="SLOT_LABEL[slot]" />
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    <HackModChip v-for="m in (slotItem(agent, slot)!.mods as ItemMod[])" :key="m.type"
                      :label="MOD_LABEL[m.type]" :value="formatModValue(m.type, m.value)" />
                  </div>
                </div>

                <div v-else class="hack-frame hack-frame-tight flex items-center gap-3 px-4 py-2.5 opacity-60">
                  <UIcon :name="SLOT_ICON[slot]" class="size-4 shrink-0 text-muted" />
                  <span class="text-sm text-muted">{{ SLOT_LABEL[slot] }} — empty</span>
                </div>
              </div>
            </div>
          </HackFrame>

          <!-- Empty active slots -->
          <div v-for="i in (state.rosterSlots - state.agents.length)" :key="`empty-${i}`"
            class="hack-frame hack-frame-tight border-dashed flex flex-col items-center justify-center h-36 gap-1 text-muted">
            <UIcon name="i-lucide-user-plus" class="size-6 opacity-30" />
            <span class="text-sm">{{ state.storedAgents.length ? 'Empty active slot — activate from storage' : 'Empty active slot — recruit from the Black Market' }}</span>
          </div>
        </div>
      </section>

      <!-- Storage -->
      <div v-if="state.storedAgents.length" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="hack-stat-label-md flex items-center gap-2">
            <UIcon name="i-lucide-archive" class="size-4" /> Storage
          </h2>
          <p class="text-sm text-muted">Inactive agents — don't count toward power. Click for details.</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div
            v-for="agent in state.storedAgents" :key="agent.id"
            class="hack-frame hack-frame-tight flex items-center gap-3 p-3 cursor-pointer hover:border-primary/40 transition-colors"
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
              <p class="hack-stat-value-lg text-primary leading-none">{{ agent.power }}</p>
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
        <div>
          <p class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Total Bonuses</p>
          <div v-if="agentCombinedStats(detailAgent).length" class="flex flex-wrap gap-1.5">
            <HackModChip v-for="s in agentCombinedStats(detailAgent)" :key="s.label" :label="s.label" :value="s.fmt(s.value)" />
          </div>
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
        <div class="flex items-center gap-2">
          <UButton color="primary" variant="soft" icon="i-lucide-shield-half" label="Equip"
            :to="detailAgent ? `/hack/loadout?agent=${detailAgent.id}` : undefined" />
          <UButton v-if="detailAgentActive" color="neutral" variant="soft" icon="i-lucide-archive" label="Store"
            :loading="togglingActive === detailAgent?.id"
            :disabled="!!detailAgent && busyAgentIds.has(detailAgent.id)"
            @click="detailAgent && setActive(detailAgent.id, false)" />
          <UButton v-else color="primary" icon="i-lucide-arrow-up-circle" label="Activate"
            :loading="togglingActive === detailAgent?.id" :disabled="activeFull"
            @click="detailAgent && setActive(detailAgent.id, true)" />
        </div>
      </div>
    </template>
  </UModal>
</template>
