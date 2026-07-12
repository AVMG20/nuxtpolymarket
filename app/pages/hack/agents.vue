<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_STYLE, RARITY_ACCENT, RARITY_ORDER, CLASS_LABEL, CLASS_ICON, CLASS_PASSIVE,
  SLOT_ICON, SLOT_LABEL,
  xpToNextLevel, AGENT_MAX_LEVEL, MOD_LABEL, MOD_RANGES, formatModValue, rollPct,
  agentBonusStats, sortModsByPriority, itemPower,
  type HackRarity, type AgentClass, type ItemSlot, type ItemMod
} from '#shared/utils/hack-config'
import { AGENT_ACTIVATE, AGENT_DEACTIVATE, AGENT_FIRED, ROSTER_EXPAND, pickVoiceLine, type VoiceEntry } from '~/utils/hack-voice-lines'
import type { VoiceHandle } from '~/composables/useAudio'

const agentCombinedStats = (agent: any) => agentBonusStats([agent])

const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()
const audio = useAudio('hack')

// RELAY's one-liners on roster actions. Audio-only (no on-screen caption here),
// picked with no-immediate-repeat, and single-tracked so rapid actions cut the
// previous line instead of stacking voices. Throttled via barkThrottle (same
// cadence as reveal barks) so an action spree doesn't talk over itself on
// every single click.
let barkHandle: VoiceHandle | null = null
function relayBark(entry: VoiceEntry) {
  barkHandle?.cancel()
  if (!audio.barkThrottle()) return
  barkHandle = audio.playVoice(pickVoiceLine(entry).voice, { delayMs: 80 })
}
onUnmounted(() => barkHandle?.cancel())

// Fire agent — arms a confirm first; a second click within the window fires.
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
    relayBark(AGENT_FIRED)
    toast.add({ title: `${name} dismissed`, color: 'neutral' })
    if (detailAgentId.value === agentId) detailAgentId.value = null
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    audio.playSfx('deny')
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
    relayBark(active ? AGENT_ACTIVATE : AGENT_DEACTIVATE)
    toast.add({ title: active ? 'Agent activated' : 'Agent moved to storage', color: active ? 'success' : 'neutral' })
    detailAgentId.value = null
    await refresh()
  } catch (e: any) {
    audio.playSfx('deny')
    toast.add({ title: e.data?.statusMessage ?? 'Failed', color: 'error' })
  } finally { togglingActive.value = null }
}

// Agent detail modal, opened by clicking a stored agent.
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
  set: (v: boolean) => { if (!v) detailAgentId.value = null }
})

const expanding = ref(false)
async function expandRoster() {
  expanding.value = true
  try {
    await $fetch('/api/hack/roster/expand', { method: 'POST' })
    relayBark(ROSTER_EXPAND)
    toast.add({ title: 'Roster expanded', color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    audio.playSfx('deny')
    toast.add({ title: e.data?.statusMessage ?? 'Failed', color: 'error' })
  } finally { expanding.value = false }
}

// ── Helpers ────────────────────────────────────────────────────────
const busyAgentIds = computed(() =>
  new Set(state.value?.activeOps.flatMap(o => o.agentIds) ?? [])
)
function xpPercent(a: { xp: number, level: number }) {
  if (a.level >= AGENT_MAX_LEVEL) return 100
  return Math.round((a.xp / xpToNextLevel(a.level)) * 100)
}
function slotItem(agent: { gear?: { tool: any, software: any, hardware: any } }, slot: ItemSlot) {
  return agent.gear?.[slot] ?? null
}
function gearCount(agent: { gear?: { tool: any, software: any, hardware: any } }) {
  return (['tool', 'software', 'hardware'] as ItemSlot[]).filter(s => slotItem(agent, s)).length
}

// ── Sleeper sort ─────────────────────────────────────────────────────
const sleeperSortBy = ref<'power' | 'rarity' | 'level'>('power')
const sortedStoredAgents = computed(() => {
  const agents = [...(state.value?.storedAgents ?? [])]
  agents.sort((a, b) => {
    if (sleeperSortBy.value === 'power') return b.power - a.power
    if (sleeperSortBy.value === 'level') return b.level - a.level
    const r = RARITY_ORDER.indexOf(b.rarity as HackRarity) - RARITY_ORDER.indexOf(a.rarity as HackRarity)
    return r !== 0 ? r : b.power - a.power
  })
  return agents
})
</script>

<template>
  <div class="p-6 pb-12 overflow-y-auto h-full">
    <!-- Header -->
    <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
      <div>
        <p class="hack-eyebrow">
          // roster management
        </p>
        <h1 class="text-2xl font-bold mt-1.5">
          Agents
        </h1>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <UButton
          v-if="state && state.rosterSlots < state.maxRosterSlots"
          color="neutral"
          variant="outline"
          icon="i-lucide-user-plus"
          :loading="expanding"
          :disabled="balance < (state.rosterExpandCost ?? Infinity)"
          @click="expandRoster"
        >
          Add Slot — ${{ formatNumber(state.rosterExpandCost ?? 0, true) }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          to="/hack/market"
          icon="i-lucide-store"
          label="Need more agents? → Black Market"
        />
      </div>
    </div>

    <div
      v-if="!state"
      class="grid grid-cols-1 md:grid-cols-2 gap-4"
    >
      <USkeleton
        v-for="i in 2"
        :key="i"
        class="h-72 rounded-xl"
      />
    </div>

    <!-- Large screens: active roster (left) + sleepers (right). Small: stacked. -->
    <div
      v-else
      class="grid grid-cols-1 xl:grid-cols-[1.5fr_340px] gap-6 items-start"
    >
      <!-- ── Active roster ────────────────────────────────────────────── -->
      <section>
        <p class="hack-stat-label-md flex items-center gap-2.5 mb-3.5">
          Active roster <span class="text-muted normal-case tracking-normal">— {{ state.agents.length }} / {{ state.rosterSlots }} slots</span>
          <span class="flex-1 h-px bg-(--hack-border)" />
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 huge:grid-cols-3! gap-4">
          <HackFrame
            v-for="agent in state.agents"
            :key="agent.id"
            class="p-5"
          >
            <!-- Header: portrait + identity + xp -->
            <div class="flex items-start gap-4 mb-4">
              <HackAgentAvatar
                class="size-30 shrink-0"
                :name="agent.name"
                :rarity="agent.rarity as HackRarity"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-2">
                    <span class="hack-card-title-lg text-lg">{{ agent.name }}</span>
                    <UBadge
                      :color="RARITY_COLOR[agent.rarity as HackRarity]"
                      variant="subtle"
                      :label="RARITY_LABEL[agent.rarity as HackRarity]"
                    />
                    <UBadge
                      v-if="busyAgentIds.has(agent.id)"
                      color="primary"
                      variant="subtle"
                      label="On Op"
                    />
                  </div>
                  <div class="text-right shrink-0">
                    <p class="text-xs text-muted">
                      Power Total
                    </p>
                    <p class="text-xl font-bold text-primary">
                      {{ agent.power }}
                    </p>
                  </div>
                </div>
                <p class="text-xs text-muted font-mono mt-1 flex items-center gap-1.5 flex-wrap">
                  <UIcon
                    :name="CLASS_ICON[agent.class as AgentClass]"
                    class="size-3.5"
                  />
                  {{ CLASS_LABEL[agent.class as AgentClass] }} · {{ CLASS_PASSIVE[agent.class as AgentClass].label }}
                </p>
                <div class="mt-2">
                  <div class="flex justify-between text-[11px] mb-1">
                    <span class="text-muted">Lv {{ agent.level }}<span v-if="agent.level < AGENT_MAX_LEVEL"> / {{ AGENT_MAX_LEVEL }}</span></span>
                    <span
                      v-if="agent.level < AGENT_MAX_LEVEL"
                      class="text-muted font-mono"
                    >{{ agent.xp }} / {{ xpToNextLevel(agent.level) }} XP</span>
                    <span
                      v-else
                      class="text-success font-semibold"
                    >Max</span>
                  </div>
                  <div class="h-1.5 bg-elevated overflow-hidden">
                    <div
                      class="h-full bg-violet-400 transition-all duration-500"
                      :style="{ width: `${xpPercent(agent)}%` }"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Total bonuses -->
            <div
              v-if="agentCombinedStats(agent).length"
              class="flex flex-wrap gap-1.5 mb-4"
            >
              <HackModChip
                v-for="s in agentCombinedStats(agent)"
                :key="s.label"
                :label="s.label"
                :value="s.fmt(s.value)"
              />
            </div>

            <!-- Equipped gear — collapsed by default; gear is secondary on this
                 roster view, so it stays out of the way until expanded. -->
            <UCollapsible
              :default-open="false"
              class="mb-4"
            >
              <template #default="{ open }">
                <button
                  type="button"
                  class="w-full flex items-center justify-between gap-2 mb-2"
                >
                  <span class="hack-stat-label-md">
                    Equipped gear <span class="text-muted normal-case tracking-normal">— {{ gearCount(agent) }} / 3</span>
                  </span>
                  <UIcon
                    name="i-lucide-chevron-down"
                    class="size-4 text-muted transition-transform"
                    :class="open && 'rotate-180'"
                  />
                </button>
              </template>

              <template #content>
                <div class="space-y-2 pt-1">
                  <div
                    v-for="slot in (['tool', 'software', 'hardware'] as ItemSlot[])"
                    :key="slot"
                  >
                <div
                  v-if="slotItem(agent, slot)"
                  class="hack-frame hack-frame-tight hack-frame-2 relative pl-4 pr-3 py-2.5"
                >
                  <span
                    class="absolute inset-y-0 left-0 w-1"
                    :class="RARITY_ACCENT[slotItem(agent, slot)!.rarity as HackRarity]"
                  />
                  <div class="flex items-start gap-3">
                    <div
                      class="size-12 shrink-0 flex items-center justify-center border"
                      :class="[
                        RARITY_STYLE[slotItem(agent, slot)!.rarity as HackRarity].bg,
                        RARITY_STYLE[slotItem(agent, slot)!.rarity as HackRarity].border,
                        RARITY_STYLE[slotItem(agent, slot)!.rarity as HackRarity].text
                      ]"
                    >
                      <UIcon
                        :name="SLOT_ICON[slot]"
                        class="size-5"
                      />
                    </div>
                    <div class="flex-1 min-w-0">
                      <span
                        class="font-bold text-[15px] leading-snug"
                        :class="RARITY_STYLE[slotItem(agent, slot)!.rarity as HackRarity].text"
                      >{{ slotItem(agent, slot)!.name }}</span>
                      <p class="text-sm font-mono font-bold text-zinc-100 mt-0.5">
                        Level {{ slotItem(agent, slot)!.itemLevel }}
                      </p>
                      <p class="text-xs text-muted font-mono mt-1">
                        Base <b class="text-primary">+{{ slotItem(agent, slot)!.itemLevel * 2 }}</b> · total <b class="text-primary">{{ itemPower(slotItem(agent, slot)!) }} PWR</b>
                      </p>
                      <div class="flex flex-wrap gap-1.5 mt-2">
                        <HackModChip
                          v-for="m in sortModsByPriority(slotItem(agent, slot)!.mods as ItemMod[])"
                          :key="m.type"
                          :label="MOD_LABEL[m.type]"
                          :value="formatModValue(m.type, m.value)"
                          :pct="rollPct(MOD_RANGES[m.type], m.value)"
                          :value-max="formatModValue(m.type, MOD_RANGES[m.type].max)"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  v-else
                  class="hack-frame hack-frame-tight border-dashed flex items-center gap-2.5 px-4 py-2.5 opacity-70"
                >
                  <UIcon
                    :name="SLOT_ICON[slot]"
                    class="size-4 shrink-0 text-muted"
                  />
                  <span class="text-xs text-muted font-mono uppercase tracking-wide">Empty {{ SLOT_LABEL[slot] }} slot</span>
                </div>
                  </div>
                </div>
              </template>
            </UCollapsible>

            <!-- Footer: power + actions -->
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="font-mono text-lg font-bold text-primary">PWR {{ agent.power }}</span>
              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-shield-half"
                  label="Equip"
                  :to="`/hack/loadout?agent=${agent.id}`"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-archive"
                  label="Store"
                  :loading="togglingActive === agent.id"
                  :disabled="busyAgentIds.has(agent.id)"
                  @click="setActive(agent.id, false)"
                />
                <UButton
                  size="xs"
                  color="error"
                  icon="i-lucide-user-x"
                  :variant="fireConfirmId === agent.id ? 'soft' : 'ghost'"
                  :label="fireConfirmId === agent.id ? 'Sure?' : 'Fire'"
                  :loading="firing === agent.id"
                  :disabled="busyAgentIds.has(agent.id)"
                  @click="requestFire(agent.id, agent.name)"
                />
              </div>
            </div>
          </HackFrame>

          <!-- Open slot tile -->
          <div
            v-for="i in (state.rosterSlots - state.agents.length)"
            :key="`empty-${i}`"
            class="hack-frame hack-frame-tight border-dashed flex flex-col items-center justify-center min-h-[220px] gap-3 text-center p-6"
          >
            <p class="hack-eyebrow">
              Open slot
            </p>
            <p class="text-sm text-muted">
              {{ state.storedAgents.length ? 'Activate an agent from storage' : 'Recruit an agent at the Black Market' }}
            </p>
            <UButton
              v-if="state.storedAgents.length"
              color="neutral"
              variant="soft"
              size="sm"
              to="/hack/market"
              icon="i-lucide-store"
              label="Black Market"
            />
          </div>
        </div>
      </section>

      <!-- ── Sleeper agents (right on xl, below on small) ────────────────── -->
      <section v-if="state.storedAgents.length">
        <p class="hack-stat-label-md flex items-center gap-2.5 mb-2">
          Sleeper agents <span class="text-muted normal-case tracking-normal">— {{ state.storedAgents.length }} stored, {{ state.maxAgents }} max</span>
          <span class="flex-1 h-px bg-(--hack-border)" />
        </p>
        <USelect
          v-model="sleeperSortBy"
          :items="[
            { value: 'power', label: 'Power' },
            { value: 'rarity', label: 'Rarity' },
            { value: 'level', label: 'Level' }
          ]"
          size="xs"
          class="w-28 mb-3.5"
        />
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-2.5">
          <HackFrame
            v-for="agent in sortedStoredAgents"
            :key="agent.id"
            tight
            class="p-3"
          >
            <div class="flex items-start gap-3">
              <HackAgentAvatar
                class="size-26 shrink-0 cursor-pointer"
                :name="agent.name"
                :rarity="agent.rarity as HackRarity"
                @click="detailAgentId = agent.id"
              />
              <div class="flex-1 min-w-0 space-y-2">
                <div
                  class="cursor-pointer"
                  @click="detailAgentId = agent.id"
                >
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold text-sm truncate">{{ agent.name }}</span>
                    <UBadge
                      size="xs"
                      :color="RARITY_COLOR[agent.rarity as HackRarity]"
                      variant="subtle"
                      :label="RARITY_LABEL[agent.rarity as HackRarity]"
                    />
                  </div>
                  <p class="text-[11px] text-muted font-mono mt-0.5">
                    {{ CLASS_LABEL[agent.class as AgentClass] }} · Lv {{ agent.level }} · PWR {{ agent.power }}
                  </p>
                </div>
                <UButton
                  size="xs"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-arrow-up-circle"
                  label="Activate"
                  block
                  :loading="togglingActive === agent.id"
                  :disabled="activeFull"
                  @click="setActive(agent.id, true)"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-shield-half"
                  label="Equip"
                  block
                  :to="`/hack/loadout?agent=${agent.id}`"
                />
              </div>
            </div>
          </HackFrame>
        </div>
        <p
          v-if="activeFull"
          class="text-xs text-muted mt-2"
        >
          Active roster is full — store or fire an active agent (or add a slot) to activate more.
        </p>
      </section>
    </div>
  </div>

  <!-- Agent detail — click a stored agent to view/manage them -->
  <UModal
    v-model:open="detailModalOpen"
    :title="detailAgent?.name ?? 'Agent'"
    :description="detailAgentActive ? 'Active on your roster.' : 'In storage — activate to add them to your roster.'"
  >
    <template
      v-if="detailAgent"
      #body
    >
      <div class="space-y-4">
        <div class="flex items-start gap-3">
          <HackAgentAvatar
            class="size-22 shrink-0"
            :name="detailAgent.name"
            :rarity="detailAgent.rarity as HackRarity"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-lg">{{ detailAgent.name }}</span>
              <UBadge
                :color="RARITY_COLOR[detailAgent.rarity as HackRarity]"
                variant="subtle"
                :label="RARITY_LABEL[detailAgent.rarity as HackRarity]"
              />
            </div>
            <div class="flex items-center gap-1.5 mt-1 text-xs">
              <UIcon
                :name="CLASS_ICON[detailAgent.class as AgentClass]"
                class="size-3.5 text-muted"
              />
              <span class="font-medium">{{ CLASS_LABEL[detailAgent.class as AgentClass] }}</span>
              <span class="text-muted">· {{ CLASS_PASSIVE[detailAgent.class as AgentClass].label }}</span>
            </div>
          </div>
          <div class="text-right shrink-0">
            <p class="text-sm text-muted">
              Power
            </p>
            <p class="text-2xl font-bold text-primary">
              {{ detailAgent.power }}
            </p>
          </div>
        </div>

        <div>
          <div class="flex justify-between text-sm mb-1.5">
            <span class="font-medium">Lv {{ detailAgent.level }}<span
              v-if="detailAgent.level < AGENT_MAX_LEVEL"
              class="text-muted"
            > / {{ AGENT_MAX_LEVEL }}</span></span>
            <span
              v-if="detailAgent.level < AGENT_MAX_LEVEL"
              class="text-muted"
            >{{ detailAgent.xp }} / {{ xpToNextLevel(detailAgent.level) }} XP</span>
            <span
              v-else
              class="text-success font-semibold"
            >Max Level</span>
          </div>
          <div class="h-2 rounded-full bg-elevated overflow-hidden">
            <div
              class="h-full rounded-full bg-violet-400 transition-all duration-500"
              :style="{ width: `${xpPercent(detailAgent)}%` }"
            />
          </div>
        </div>

        <div>
          <p class="text-sm font-semibold text-muted uppercase tracking-wide mb-2">
            Total Bonuses
          </p>
          <div
            v-if="agentCombinedStats(detailAgent).length"
            class="flex flex-wrap gap-1.5"
          >
            <HackModChip
              v-for="s in agentCombinedStats(detailAgent)"
              :key="s.label"
              :label="s.label"
              :value="s.fmt(s.value)"
            />
          </div>
          <p
            v-else
            class="text-sm text-muted italic"
          >
            No traits.
          </p>
        </div>

        <div class="space-y-2">
          <div
            v-for="slot in (['tool', 'software', 'hardware'] as ItemSlot[])"
            :key="slot"
          >
            <div
              v-if="slotItem(detailAgent, slot)"
              class="flex items-start gap-3 p-3 rounded-lg border border-default"
            >
              <div class="size-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 bg-elevated text-muted">
                <UIcon
                  :name="SLOT_ICON[slot]"
                  class="size-4"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap mb-1">
                  <span class="font-medium text-sm">{{ slotItem(detailAgent, slot)!.name }}</span>
                  <UBadge
                    size="xs"
                    :color="RARITY_COLOR[slotItem(detailAgent, slot)!.rarity as HackRarity]"
                    variant="subtle"
                    :label="RARITY_LABEL[slotItem(detailAgent, slot)!.rarity as HackRarity]"
                  />
                </div>
                <div class="flex flex-wrap gap-x-3">
                  <span
                    v-for="m in (slotItem(detailAgent, slot)!.mods as ItemMod[])"
                    :key="m.type"
                    class="text-sm font-medium text-primary"
                  >
                    {{ MOD_LABEL[m.type] }} {{ formatModValue(m.type, m.value) }}
                  </span>
                </div>
              </div>
            </div>
            <div
              v-else
              class="flex items-center gap-3 p-3 rounded-lg border border-dashed border-default"
            >
              <UIcon
                :name="SLOT_ICON[slot]"
                class="size-4 shrink-0 text-muted opacity-60"
              />
              <span class="text-sm text-muted">{{ SLOT_LABEL[slot] }} — empty</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3 w-full">
        <UButton
          color="error"
          icon="i-lucide-user-x"
          :variant="fireConfirmId === detailAgent?.id ? 'soft' : 'ghost'"
          :label="fireConfirmId === detailAgent?.id ? 'Sure?' : 'Fire'"
          :loading="firing === detailAgent?.id"
          :disabled="!!detailAgent && busyAgentIds.has(detailAgent.id)"
          @click="detailAgent && requestFire(detailAgent.id, detailAgent.name)"
        />
        <div class="flex items-center gap-2">
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-shield-half"
            label="Equip"
            :to="detailAgent ? `/hack/loadout?agent=${detailAgent.id}` : undefined"
          />
          <UButton
            v-if="detailAgentActive"
            color="neutral"
            variant="soft"
            icon="i-lucide-archive"
            label="Store"
            :loading="togglingActive === detailAgent?.id"
            :disabled="!!detailAgent && busyAgentIds.has(detailAgent.id)"
            @click="detailAgent && setActive(detailAgent.id, false)"
          />
          <UButton
            v-else
            color="primary"
            icon="i-lucide-arrow-up-circle"
            label="Activate"
            :loading="togglingActive === detailAgent?.id"
            :disabled="activeFull"
            @click="detailAgent && setActive(detailAgent.id, true)"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
