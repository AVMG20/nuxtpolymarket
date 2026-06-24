<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, CLASS_LABEL, CLASS_ICON, CLASS_COLOR, CLASS_PASSIVE,
  AGENT_TRAIT_LABEL, formatTraitValue,
  effectiveDurationMs, collectBonuses, effectiveCashRange, effectiveGemChance, opSuccessChance, MIN_DEPLOY_SUCCESS,
  type HackRarity, type AgentClass, type AgentTrait, type AgentTraitType, type ItemMod,
} from '#shared/utils/hack-config'

const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()

// Live countdown ticker
const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(t))
})

function msLeft(completesAt: string | Date) {
  return Math.max(0, new Date(completesAt).getTime() - now.value)
}
function formatMs(ms: number) {
  if (ms <= 0) return 'Done'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
function formatDuration(ms: number) {
  const h = Math.round(ms / 3_600_000)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  const rem = h % 24
  return rem ? `${d}d ${rem}h` : `${d}d`
}
function progressPct(op: { startedAt: string; completesAt: string }) {
  const total = new Date(op.completesAt).getTime() - new Date(op.startedAt).getTime()
  const elapsed = now.value - new Date(op.startedAt).getTime()
  return Math.min(100, Math.round((elapsed / total) * 100))
}

// Dispatch
const dispatching = ref(false)
const selectedTemplate = ref<any | null>(null)
const dispatchModalOpen = computed({
  get: () => !!selectedTemplate.value,
  set: (v) => { if (!v) selectedTemplate.value = null },
})
const selectedAgentIds = ref<string[]>([])

function openDispatch(template: any) {
  selectedTemplate.value = template
  selectedAgentIds.value = []
}

function toggleAgent(id: string, template: any) {
  const idx = selectedAgentIds.value.indexOf(id)
  if (idx >= 0) {
    selectedAgentIds.value.splice(idx, 1)
  } else if (selectedAgentIds.value.length < template.maxAgents) {
    selectedAgentIds.value.push(id)
  }
}

async function dispatch() {
  if (!selectedTemplate.value) return
  dispatching.value = true
  try {
    await $fetch('/api/hack/ops/dispatch', {
      method: 'POST',
      body: { templateId: selectedTemplate.value.id, agentIds: selectedAgentIds.value },
    })
    toast.add({ title: `Op dispatched`, description: selectedTemplate.value.name, color: 'success' })
    selectedTemplate.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Dispatch failed', color: 'error' })
  } finally {
    dispatching.value = false
  }
}

// Collect
const collecting = ref<string | null>(null)
async function collect(opId: string) {
  collecting.value = opId
  try {
    const res = await $fetch('/api/hack/ops/collect', { method: 'POST', body: { opId } })
    if (!res.success) {
      const desc = `Op failed. Agents gained ${res.xpPerAgent} XP each.`
      toast.add({ title: 'Mission Failed', description: desc, color: 'error' })
    } else {
      let desc = `+$${formatNumber(res.cash, true)}`
      if (res.gems > 0) desc += ` · +${res.gems} 💎`
      if (res.item) desc += ` · Gear: ${res.item.name}`
      if (res.levelUps?.length) desc += ` · ${res.levelUps.length} level up${res.levelUps.length > 1 ? 's' : ''}!`
      if (res.inventoryFull) desc += ' · Inventory full, item lost'
      toast.add({ title: 'Op complete', description: desc, color: 'success' })
    }
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Collect failed', color: 'error' })
  } finally {
    collecting.value = null
  }
}

// Helpers
const busyAgentIds = computed(() =>
  new Set(state.value?.activeOps.flatMap(o => o.agentIds) ?? [])
)
function agentById(id: string) {
  return state.value?.agents.find(a => a.id === id)
}
function freeAgents() {
  return state.value?.agents.filter(a => !busyAgentIds.value.has(a.id)) ?? []
}

const modalStats = computed(() => {
  if (!selectedTemplate.value || !state.value || selectedAgentIds.value.length === 0) return null
  const template = selectedTemplate.value
  const agents = selectedAgentIds.value
    .map(id => state.value!.agents.find(a => a.id === id))
    .filter(Boolean) as NonNullable<typeof state.value>['agents']
  const allItems = agents.flatMap(a =>
    ([a.gear?.tool, a.gear?.software, a.gear?.hardware] as any[]).filter(Boolean)
  )
  const power = agents.reduce((s, a) => s + a.power, 0)
  const successChance = opSuccessChance(power, template.minPower)
  const bonuses = collectBonuses(
    agents.map(a => ({ level: a.level, class: a.class as AgentClass })),
    allItems.map((i: any) => ({ mods: i.mods as ItemMod[] })),
    agents.length,
  )
  // Fold in agent trait bonuses so the preview matches the actual reward roll.
  const allTraits = agents.flatMap(a => (a.traits ?? []) as AgentTrait[])
  const sumTrait = (t: AgentTraitType) => allTraits.filter(x => x.type === t).reduce((s, x) => s + x.value, 0)
  const extBonuses = {
    ...bonuses,
    lootPct: bonuses.lootPct + sumTrait('loot_percent') / 100,
    groupPct: bonuses.groupPct + (agents.length >= 2 ? sumTrait('group_loot') / 100 : 0),
    gemChance: bonuses.gemChance + sumTrait('gem_chance'),
  }
  const cashRange = effectiveCashRange(template, extBonuses)
  const gemChance = effectiveGemChance(template, extBonuses)
  const durationMs = effectiveDurationMs(
    template,
    agents.map(a => ({ class: a.class as AgentClass, traits: (a.traits ?? []) as AgentTrait[] })),
    allItems.map((i: any) => ({ mods: i.mods as ItemMod[] })),
  )
  // Combine class passives + traits across all agents, summed by modifier type
  const modTotals: Record<string, number> = {}
  for (const agent of agents) {
    const passive = CLASS_PASSIVE[agent.class as AgentClass]
    // speed_percent and loot_percent passives are fractions (0.15), traits are integers (15) — normalize to same scale
    const normalizedPassive = (passive.type === 'speed_percent' || passive.type === 'loot_percent')
      ? passive.value * 100 : passive.value
    modTotals[passive.type] = (modTotals[passive.type] ?? 0) + normalizedPassive
    for (const trait of (agent.traits ?? []) as AgentTrait[]) {
      modTotals[trait.type] = (modTotals[trait.type] ?? 0) + trait.value
    }
  }
  const combinedMods = (Object.entries(modTotals) as [AgentTraitType, number][])
    .filter(([, v]) => v > 0)
    .map(([type, total]) => ({ label: AGENT_TRAIT_LABEL[type], value: formatTraitValue(type, total) }))
  return { power, successChance, cashRange, gemChance, durationMs, combinedMods }
})

function statusColor(status: string) {
  if (status === 'available') return 'success'
  if (status === 'close') return 'warning'
  return 'neutral'
}
function statusLabel(status: string, template: any) {
  if (status === 'no_agents') return 'No free agents'
  if (status === 'available') return 'Ready'
  if (status === 'close') return `${template.bestPower} / ${template.minPower} power`
  return `Need ${template.minPower} power`
}
function powerColorClass(status: string) {
  if (status === 'available') return 'text-success'
  if (status === 'close') return 'text-warning'
  if (status === 'locked') return 'text-error'
  return 'text-muted'
}

// ── List view ────────────────────────────────────────────────────────────────
// Operations sorted by money value (lowest first) so cheaper, reachable ops sit at
// the top and the ladder climbs as you scroll.
const sortedTemplates = computed(() => {
  if (!state.value) return []
  return [...state.value.opTemplates].sort(
    (a, b) => (a.baseCash[0] + a.baseCash[1]) - (b.baseCash[0] + b.baseCash[1]),
  )
})

const expandedId = ref<string | null>(null)
function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

// Deploy is impossible when there aren't enough free agents, or when even your best
// possible team can't reach the minimum success chance — block it in those cases.
function canDeploy(t: any) {
  return t.status !== 'no_agents' && t.effectiveSuccessChance >= MIN_DEPLOY_SUCCESS
}
function deployBlockedReason(t: any): string | null {
  if (t.status === 'no_agents') {
    return `Need ${t.minAgents} free agent${t.minAgents > 1 ? 's' : ''}`
  }
  if (t.effectiveSuccessChance < MIN_DEPLOY_SUCCESS) {
    return `Power too low — best ${t.bestPower} / ${t.minPower}`
  }
  return null
}
</script>

<template>
  <UContainer class="space-y-6 py-6 pb-12">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-bold">Hack Ops</h1>
        <p class="text-sm text-muted mt-0.5">Deploy agents on timed operations to earn cash and gear.</p>
      </div>
      <div v-if="state" class="flex gap-2 text-sm flex-wrap">
        <UTooltip text="Combined power of all your agents (including equipped gear). Higher power unlocks tougher ops and raises success chance.">
          <div class="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 flex items-center gap-1.5">
            <UIcon name="i-lucide-zap" class="size-4 text-primary" />
            <span class="text-muted">Power</span>
            <span class="font-bold text-primary">{{ formatNumber(state.totalPower, true) }}</span>
          </div>
        </UTooltip>
        <div class="px-3 py-1.5 rounded-lg bg-elevated border border-default">
          <span class="text-muted">Agents </span>
          <span class="font-bold">{{ state.agents.length }}/{{ state.rosterSlots }}</span>
        </div>
        <div class="px-3 py-1.5 rounded-lg bg-elevated border border-default">
          <span class="text-muted">On ops </span>
          <span class="font-bold">{{ state.activeOps.length }}</span>
        </div>
      </div>
    </div>

    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-28 rounded-xl" v-for="i in 3" :key="i" />
    </div>

    <template v-else>
      <!-- Active Ops -->
      <div v-if="state.activeOps.length" class="space-y-3">
        <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">Active Operations</h2>
        <UCard v-for="op in state.activeOps" :key="op.id">
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3 min-w-0">
              <div class="size-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <UIcon :name="state.opTemplates.find(t => t.id === op.templateId)?.icon ?? 'i-lucide-terminal'" class="size-5 text-primary" />
              </div>
              <div class="min-w-0">
                <p class="font-semibold">{{ state.opTemplates.find(t => t.id === op.templateId)?.name }}</p>
                <div class="flex flex-wrap gap-1.5 mt-1">
                  <UBadge
                    v-for="aid in op.agentIds" :key="aid"
                    size="sm"
                    :color="RARITY_COLOR[agentById(aid)?.rarity as HackRarity] ?? 'neutral'"
                    variant="subtle"
                    :label="agentById(aid)?.name ?? aid"
                  />
                </div>
              </div>
            </div>
            <div class="text-right shrink-0">
              <p class="text-lg font-bold" :class="op.done ? 'text-success' : 'text-primary'">
                {{ formatMs(msLeft(op.completesAt)) }}
              </p>
              <UButton
                v-if="op.done"
                size="sm"
                color="success"
                :loading="collecting === op.id"
                @click="collect(op.id)"
                label="Collect"
                icon="i-lucide-download"
              />
            </div>
          </div>
          <div class="mt-3 h-1.5 rounded-full bg-elevated overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-1000"
              :class="op.done ? 'bg-success' : 'bg-primary'"
              :style="{ width: `${progressPct(op)}%` }"
            />
          </div>
        </UCard>
      </div>

      <!-- Op Templates — compact list, sorted by money value -->
      <div class="space-y-3">
        <h2 class="text-sm font-semibold text-muted uppercase tracking-wide">Available Operations</h2>

        <div v-if="!freeAgents().length" class="text-sm text-muted p-4 rounded-lg bg-elevated border border-default text-center">
          All agents are deployed. Collect your ops or recruit more agents.
        </div>

        <div class="rounded-xl border border-default overflow-hidden bg-default">
          <!-- Column header (desktop) -->
          <div class="hidden sm:flex items-center gap-3 px-4 py-2 bg-elevated/60 border-b border-default text-[11px] font-medium uppercase tracking-wide text-muted">
            <span class="size-9 shrink-0" />
            <span class="flex-1">Operation</span>
            <span class="w-28 text-right">Payout</span>
            <span class="w-16 text-right">Gems</span>
            <span class="w-20 text-right">Power</span>
            <span class="w-16 text-right">Agents</span>
            <span class="w-14 text-right">Time</span>
            <span class="size-4 shrink-0" />
          </div>

          <div class="divide-y divide-default">
            <div v-for="template in sortedTemplates" :key="template.id">
              <!-- Row -->
              <button
                type="button"
                class="w-full text-left px-3 sm:px-4 py-2.5 flex items-center gap-3 hover:bg-elevated/40 transition-colors"
                :class="expandedId === template.id && 'bg-elevated/40'"
                @click="toggleExpand(template.id)"
              >
                <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <UIcon :name="template.icon" class="size-4.5 text-primary" />
                </div>

                <!-- Name + status -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-sm truncate">{{ template.name }}</span>
                    <UBadge
                      size="sm" variant="subtle" class="shrink-0 hidden sm:inline-flex"
                      :color="statusColor(template.status)"
                      :label="statusLabel(template.status, template)"
                    />
                  </div>
                  <!-- Mobile inline stats -->
                  <div class="flex items-center gap-3 mt-1 text-xs sm:hidden">
                    <span class="font-semibold text-yellow-400 flex items-center">
                      <CoinBalance :value="template.baseCash[0]" />–<CoinBalance :value="template.baseCash[1]" :show-icon="false" />
                    </span>
                    <span class="text-muted flex items-center gap-1">
                      <UIcon name="i-lucide-clock" class="size-3" />{{ formatDuration(template.durationMs) }}
                    </span>
                    <span class="flex items-center gap-1" :class="powerColorClass(template.status)">
                      <UIcon name="i-lucide-zap" class="size-3" />{{ template.minPower || 'Any' }}
                    </span>
                    <span class="text-blue-400 flex items-center gap-1">
                      <UIcon name="i-lucide-users" class="size-3" />{{ template.minAgents === template.maxAgents ? template.minAgents : `${template.minAgents}–${template.maxAgents}` }}
                    </span>
                  </div>
                </div>

                <!-- Desktop stat columns -->
                <span class="hidden sm:flex w-28 justify-end items-center font-semibold text-sm text-yellow-400 tabular-nums">
                  <CoinBalance :value="template.baseCash[0]" />–<CoinBalance :value="template.baseCash[1]" :show-icon="false" />
                </span>
                <span class="hidden sm:flex w-16 justify-end items-center text-sm tabular-nums">
                  <span v-if="template.baseGemChance > 0" class="text-cyan-400 flex items-center gap-1">
                    <GemBalance :value="template.baseGemCount[1]" />
                  </span>
                  <span v-else class="text-muted">—</span>
                </span>
                <span class="hidden sm:flex w-20 justify-end items-center text-sm font-semibold tabular-nums" :class="powerColorClass(template.status)">
                  {{ template.minPower > 0 ? (template.status !== 'available' && template.status !== 'no_agents' ? `${template.bestPower}/${template.minPower}` : template.minPower) : 'Any' }}
                </span>
                <span class="hidden sm:flex w-16 justify-end items-center gap-1 text-sm text-blue-400 font-semibold tabular-nums">
                  <UIcon name="i-lucide-users" class="size-3.5" />
                  {{ template.minAgents === template.maxAgents ? template.minAgents : `${template.minAgents}–${template.maxAgents}` }}
                </span>
                <span class="hidden sm:flex w-14 justify-end items-center text-sm text-muted tabular-nums">
                  {{ formatDuration(template.durationMs) }}
                </span>

                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 text-muted shrink-0 transition-transform"
                  :class="expandedId === template.id && 'rotate-180'"
                />
              </button>

              <!-- Expanded detail -->
              <div v-if="expandedId === template.id" class="px-3 sm:px-4 pb-3.5 pt-1 bg-elevated/40">
                <p class="text-xs text-muted">{{ template.description }}</p>
                <p class="text-xs text-muted/80 italic mt-0.5">"{{ template.flavor }}"</p>

                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                  <div class="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-default border border-default">
                    <UIcon name="i-lucide-sparkles" class="size-3.5 text-violet-400 shrink-0" />
                    <div class="min-w-0">
                      <p class="text-[10px] text-muted leading-none mb-0.5">XP / agent</p>
                      <p class="text-sm font-semibold text-violet-400">+{{ template.baseXP }}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-default border border-default">
                    <UIcon name="i-lucide-package" class="size-3.5 text-muted shrink-0" />
                    <div class="min-w-0">
                      <p class="text-[10px] text-muted leading-none mb-0.5">Item drop</p>
                      <p class="text-sm font-semibold flex items-center gap-1.5">
                        {{ Math.round(template.itemDropChance * 100) }}%
                        <UBadge size="xs" variant="subtle" :color="RARITY_COLOR[template.itemDropRarity as HackRarity]" :label="RARITY_LABEL[template.itemDropRarity as HackRarity]" />
                      </p>
                    </div>
                  </div>
                  <div v-if="template.baseGemChance > 0" class="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-default border border-default">
                    <UIcon name="i-lucide-gem" class="size-3.5 text-cyan-400 shrink-0" />
                    <div class="min-w-0">
                      <p class="text-[10px] text-muted leading-none mb-0.5">Gems</p>
                      <p class="text-sm font-semibold text-cyan-400">
                        {{ template.baseGemCount[0] }}–{{ template.baseGemCount[1] }}
                        <span class="text-muted font-normal text-xs">({{ Math.round(template.baseGemChance * 100) }}%)</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-3 mt-3">
                  <UButton
                    size="sm"
                    icon="i-lucide-send"
                    label="Deploy"
                    :disabled="!canDeploy(template)"
                    @click="openDispatch(template)"
                  />
                  <p v-if="deployBlockedReason(template)" class="text-xs text-error">
                    {{ deployBlockedReason(template) }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Dispatch Modal -->
    <UModal v-model:open="dispatchModalOpen" :title="selectedTemplate?.name ?? ''" description="Select agents to deploy on this operation.">
      <template v-if="selectedTemplate" #body>
        <div class="space-y-4">
          <p class="text-sm text-muted italic">"{{ selectedTemplate.flavor }}"</p>

          <div class="text-sm text-muted">
            Select {{ selectedTemplate.minAgents === selectedTemplate.maxAgents
              ? `${selectedTemplate.minAgents} agent${selectedTemplate.minAgents > 1 ? 's' : ''}`
              : `${selectedTemplate.minAgents}–${selectedTemplate.maxAgents} agents` }}
          </div>

          <div class="space-y-2">
            <div
              v-for="agent in state?.agents"
              :key="agent.id"
              class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
              :class="[
                busyAgentIds.has(agent.id) ? 'opacity-40 cursor-not-allowed border-default' :
                selectedAgentIds.includes(agent.id) ? 'border-primary bg-primary/10' : 'border-default hover:border-primary/50'
              ]"
              @click="!busyAgentIds.has(agent.id) && toggleAgent(agent.id, selectedTemplate)"
            >
              <div class="size-8 rounded-lg flex items-center justify-center shrink-0 ring-1"
                :class="[CLASS_COLOR[agent.class as AgentClass].bg, CLASS_COLOR[agent.class as AgentClass].ring]">
                <UIcon :name="CLASS_ICON[agent.class as AgentClass]" class="size-4"
                  :class="CLASS_COLOR[agent.class as AgentClass].text" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-sm">{{ agent.name }}</span>
                  <UBadge size="sm" :color="RARITY_COLOR[agent.rarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[agent.rarity as HackRarity]" />
                  <UBadge v-if="busyAgentIds.has(agent.id)" size="sm" color="neutral" variant="subtle" label="On Op" />
                </div>
                <p class="text-sm text-muted">
                  <span class="font-medium" :class="CLASS_COLOR[agent.class as AgentClass].text">{{ CLASS_LABEL[agent.class as AgentClass] }}</span>
                  · Lv {{ agent.level }} · {{ agent.power }} power
                </p>
                <!-- XP progress -->
                <div class="mt-1.5 flex items-center gap-2">
                  <div class="flex-1 h-1 rounded-full bg-elevated overflow-hidden">
                    <div class="h-full rounded-full bg-primary"
                      :style="{ width: `${agent.xpToNext ? Math.min(100, Math.round(agent.xp / agent.xpToNext * 100)) : 100}%` }" />
                  </div>
                  <span class="text-xs text-muted shrink-0">{{ agent.xpToNext ? `${agent.xp}/${agent.xpToNext} XP` : 'Max' }}</span>
                </div>
              </div>
              <div v-if="selectedAgentIds.includes(agent.id)" class="size-5 rounded-full bg-primary flex items-center justify-center shrink-0 self-start mt-1">
                <UIcon name="i-lucide-check" class="size-3 text-white" />
              </div>
            </div>
          </div>

          <div v-if="selectedAgentIds.length > 0 && modalStats" class="space-y-3 text-sm">
            <!-- Stats grid -->
            <div class="grid grid-cols-2 gap-2">
              <div class="flex items-center gap-2 p-2.5 rounded-lg bg-elevated border border-default">
                <UIcon name="i-lucide-zap" class="size-3.5 shrink-0" :class="modalStats.power >= selectedTemplate.minPower ? 'text-success' : 'text-warning'" />
                <div>
                  <p class="text-[10px] text-muted leading-none mb-0.5">Power</p>
                  <p class="font-bold text-sm" :class="modalStats.power >= selectedTemplate.minPower ? 'text-success' : 'text-warning'">
                    {{ modalStats.power }} / {{ selectedTemplate.minPower || '—' }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-2 p-2.5 rounded-lg bg-elevated border border-default">
                <UIcon name="i-lucide-clock" class="size-3.5 text-muted shrink-0" />
                <div>
                  <p class="text-[10px] text-muted leading-none mb-0.5">Est. time</p>
                  <p class="font-bold text-sm">{{ formatMs(modalStats.durationMs) }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 p-2.5 rounded-lg bg-elevated border border-default">
<!--                <UIcon name="i-lucide-coins" class="size-3.5 text-yellow-400 shrink-0" />-->
                <div>
                  <p class="text-[10px] text-muted leading-none mb-0.5">Cash</p>
                  <p class="font-semibold text-sm text-yellow-400 flex items-center gap-0.5">
                    <CoinBalance :value="modalStats.cashRange[0]" />–<CoinBalance :value="modalStats.cashRange[1]" :show-icon="false" />
                  </p>
                </div>
              </div>
              <div v-if="selectedTemplate.baseGemChance > 0" class="flex items-center gap-2 p-2.5 rounded-lg bg-elevated border border-default">
                <UIcon name="i-lucide-gem" class="size-3.5 text-cyan-400 shrink-0" />
                <div>
                  <p class="text-[10px] text-muted leading-none mb-0.5">Gems</p>
                  <p class="font-semibold text-sm text-cyan-400 flex items-center gap-1">
                    {{ selectedTemplate.baseGemCount[0] }}–{{ selectedTemplate.baseGemCount[1] }}
                    <span class="text-muted font-normal text-xs">({{ Math.round(modalStats.gemChance * 100) }}%)</span>
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-2 p-2.5 rounded-lg bg-elevated border border-default">
                <UIcon name="i-lucide-sparkles" class="size-3.5 text-violet-400 shrink-0" />
                <div>
                  <p class="text-[10px] text-muted leading-none mb-0.5">XP / agent</p>
                  <p class="font-semibold text-sm text-violet-400">+{{ selectedTemplate.baseXP }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 p-2.5 rounded-lg bg-elevated border border-default">
                <UIcon name="i-lucide-package" class="size-3.5 text-muted shrink-0" />
                <div>
                  <p class="text-[10px] text-muted leading-none mb-0.5">Item drop</p>
                  <p class="font-semibold text-sm flex items-center gap-1.5">
                  {{ Math.round(selectedTemplate.itemDropChance * 100) }}%
                  <UBadge size="xs" :color="RARITY_COLOR[selectedTemplate.itemDropRarity as HackRarity]" variant="subtle" :label="RARITY_LABEL[selectedTemplate.itemDropRarity as HackRarity]" />
                  </p>
                </div>
              </div>
            </div>

            <!-- Combined agent modifiers -->
            <div v-if="modalStats.combinedMods.length" class="space-y-1.5">
              <p class="text-xs font-semibold text-muted uppercase tracking-wide">Agent Modifiers</p>
              <div class="p-3 rounded-lg bg-elevated border border-default space-y-1.5">
                <div v-for="mod in modalStats.combinedMods" :key="mod.label" class="flex justify-between text-sm">
                  <span class="text-muted">{{ mod.label }}</span>
                  <span class="font-medium text-primary">{{ mod.value }}</span>
                </div>
              </div>
            </div>

            <!-- Success bar (bottom) -->
            <div>
              <div class="flex justify-between mb-1.5">
                <span class="text-muted">Success chance</span>
                <span class="font-bold" :class="modalStats.successChance < 0.25 ? 'text-error' : 'text-primary'">
                  {{ modalStats.successChance >= 1 ? '100%'
                    : modalStats.successChance < MIN_DEPLOY_SUCCESS ? '<1%'
                    : `${Math.round(modalStats.successChance * 100)}%` }}
                </span>
              </div>
              <div class="h-2 rounded-full bg-elevated overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="modalStats.successChance < 0.25 ? 'bg-error' : 'bg-primary'"
                  :style="{ width: `${Math.min(100, Math.round(modalStats.successChance * 100))}%` }"
                />
              </div>
              <p v-if="modalStats.successChance < MIN_DEPLOY_SUCCESS" class="text-sm text-error mt-1.5">
                Success chance too low to deploy — bring more power.
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex gap-2 w-full">
          <UButton color="neutral" variant="subtle" label="Cancel" @click="selectedTemplate = null" class="flex-1" />
          <UButton
            label="Deploy"
            icon="i-lucide-send"
            :loading="dispatching"
            :disabled="selectedAgentIds.length < (selectedTemplate?.minAgents ?? 1) || !modalStats || modalStats.successChance < MIN_DEPLOY_SUCCESS"
            @click="dispatch"
            class="flex-1"
          />
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
