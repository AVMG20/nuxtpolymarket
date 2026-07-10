<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_STYLE, RARITY_ACCENT, CLASS_LABEL,
  agentBonusStats,
  effectiveDurationMs, collectBonuses, effectiveCashRange, effectiveGemChance, effectiveItemDropChance, opSuccessChance, MIN_DEPLOY_SUCCESS,
  type HackRarity, type AgentClass, type AgentTrait, type ItemMod, type ItemSlot
} from '#shared/utils/hack-config'
import type { VoiceHandle } from '~/composables/useAudio'

const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()
const audio = useAudio('hack')

// Live countdown ticker
const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => {
    now.value = Date.now()
  }, 1000)
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
function formatEndTime(completesAt: string | Date) {
  return new Date(completesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function formatDuration(ms: number) {
  const h = Math.round(ms / 3_600_000)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  const rem = h % 24
  return rem ? `${d}d ${rem}h` : `${d}d`
}
function progressPct(op: { startedAt: string, completesAt: string }) {
  const total = new Date(op.completesAt).getTime() - new Date(op.startedAt).getTime()
  const elapsed = now.value - new Date(op.startedAt).getTime()
  return Math.min(100, Math.round((elapsed / total) * 100))
}
// Done is derived from the live ticker, not just the server flag (which is only
// fetched on load / after actions) — so the Collect button appears the instant the
// timer runs out, without a manual page refresh.
function isDone(op: { done?: boolean, completesAt: string }) {
  return !!op.done || msLeft(op.completesAt) <= 0
}

// Numeric ranges are always spaced around the en-dash — PLAN.md §13.5.
function cashRangeLabel(range: [number, number]) {
  return `$${formatNumber(range[0], true)} – $${formatNumber(range[1], true)}`
}
function agentRangeLabel(min: number, max: number) {
  return min === max ? String(min) : `${min} – ${max}`
}
function gemLabel(chance: number, count: [number, number]) {
  if (chance <= 0) return 'No gem chance'
  const countLabel = count[0] === count[1] ? `${count[0]}` : `${count[0]} – ${count[1]}`
  return `${Math.round(chance * 100)}% chance · ${countLabel} gem${count[1] > 1 ? 's' : ''}`
}

// ── Tier filter — tier is a client-side label (PLAN.md §11.4), not a real field.
const TIER_ORDER = ['Beginner', 'Early Mid', 'Mid', 'Late Mid', 'Endgame']
const tierFilter = ref<string | null>(null)

// Advisory success color bands, matching the wiki's documented thresholds (§11.3).
function successColorClass(chance: number) {
  const pct = chance * 100
  if (pct >= 69) return 'text-success'
  if (pct >= 31) return 'text-warning'
  return 'text-error'
}

function avatarBg(rarity: HackRarity) {
  return RARITY_ACCENT[rarity]
}

// ── Briefing overlay — an in-page view swap, not a route or a modal. Selecting
// a template swaps the mission board out for the briefing/squad-select stage.
const dispatching = ref(false)
const selectedTemplate = ref<any | null>(null)
const selectedAgentIds = ref<string[]>([])

// "Skip briefing next time" — persisted, removes the pre-roll pause on VO/caption
// playback for players who've already heard the line (mirrors the crate "quick
// open" toggle). Squad-select itself is never gated on the briefing finishing.
const skipBriefing = ref(false)
onMounted(() => {
  const saved = localStorage.getItem('hack-skip-briefing')
  if (saved !== null) skipBriefing.value = saved === 'true'
})
watch(skipBriefing, v => localStorage.setItem('hack-skip-briefing', String(v)))

const briefingVoice = computed(() => selectedTemplate.value ? missionVoice(selectedTemplate.value.id) : '')
const briefingText = computed(() => selectedTemplate.value ? missionBriefing(selectedTemplate.value.id) : '')
const briefingCaptionRef = ref<{ stop: () => void } | null>(null)

// The "pick your people" outro line — plays once per session, on the first
// squad selection of any briefing, not every time.
let outroPlayed = false
let outroHandle: VoiceHandle | null = null
function openBriefing(template: any) {
  audio.playSfx('briefing-open')
  selectedTemplate.value = template
  selectedAgentIds.value = []
}
function closeBriefing() {
  briefingCaptionRef.value?.stop()
  outroHandle?.cancel()
  selectedTemplate.value = null
}

function toggleAgent(id: string, template: any) {
  const idx = selectedAgentIds.value.indexOf(id)
  if (idx >= 0) {
    selectedAgentIds.value.splice(idx, 1)
  } else if (selectedAgentIds.value.length < template.maxAgents) {
    selectedAgentIds.value.push(id)
  }
  if (!outroPlayed && selectedAgentIds.value.length > 0) {
    outroPlayed = true
    outroHandle = audio.playVoice(pickVoiceLine(BRIEF_OUTRO).voice, { delayMs: 200 })
  }
}

async function dispatch() {
  if (!selectedTemplate.value) return
  // Stop the briefing/outro VO immediately on click rather than waiting for
  // the request to resolve — clicking Deploy is the player's own signal that
  // they're done listening.
  briefingCaptionRef.value?.stop()
  outroHandle?.cancel()
  dispatching.value = true
  try {
    await $fetch('/api/hack/ops/dispatch', {
      method: 'POST',
      body: { templateId: selectedTemplate.value.id, agentIds: selectedAgentIds.value }
    })
    audio.playSfx('deploy-confirm')
    toast.add({ title: `Op dispatched`, description: selectedTemplate.value.name, color: 'success' })
    closeBriefing()
    await refresh()
  } catch (e: any) {
    audio.playSfx('deny')
    toast.add({ title: e.data?.statusMessage ?? 'Dispatch failed', color: 'error' })
  } finally {
    dispatching.value = false
  }
}

// Collect — outcome is shown in a result modal instead of a plain toast.
const collecting = ref<string | null>(null)
const collectResult = ref<{
  success: boolean
  cash: number
  gems: number
  xpPerAgent: number
  item: { name: string, slot: ItemSlot, itemLevel: number, rarity: HackRarity, mods: ItemMod[] } | null
  inventoryFull: boolean
  levelUps: Array<{ agentId: string, agentName: string, newLevel: number }>
  templateName: string
  icon: string
} | null>(null)
const collectModalOpen = computed({
  get: () => !!collectResult.value,
  set: (v) => { if (!v) collectResult.value = null }
})

// Specialist+ item drop reads as a "rare" success for the reveal bark (voice-lines.md).
const RARE_ITEM_RARITIES: HackRarity[] = ['specialist', 'elite', 'phantom']
// Voice+text picked together (not two independent computeds) so a random
// variant pick never mismatches the caption with a different variant's clip.
const collectLine = computed(() => {
  if (!collectResult.value) return { voice: '', text: '' }
  if (!collectResult.value.success) return pickVoiceLine(COLLECT_FAILURE)
  if (collectResult.value.item && RARE_ITEM_RARITIES.includes(collectResult.value.item.rarity)) return pickVoiceLine(COLLECT_SUCCESS_RARE)
  return pickVoiceLine(COLLECT_SUCCESS)
})

async function collect(op: { id: string, templateId: string }) {
  collecting.value = op.id
  try {
    const res = await $fetch('/api/hack/ops/collect', { method: 'POST', body: { opId: op.id } })
    const template = state.value?.opTemplates.find(t => t.id === op.templateId)
    collectResult.value = {
      ...res,
      item: res.item as any,
      levelUps: res.levelUps.map(lu => ({ ...lu, agentName: agentById(lu.agentId)?.name ?? 'Agent' })),
      templateName: template?.name ?? 'Operation',
      icon: template?.icon ?? 'i-lucide-terminal'
    }
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    audio.playSfx('deny')
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

// Reward preview for a running op — what its assigned squad might pull in, plus the
// success chance. Mirrors the briefing's live-preview logic (collectBonuses folds in
// each agent's gear/class/traits). Keyed by op id so it only recomputes when state changes.
const activeOpsPreview = computed(() =>
  (state.value?.activeOps ?? []).map((op) => {
    const template = state.value!.opTemplates.find(t => t.id === op.templateId)
    if (!template) return { op, template: null, preview: null }
    const agents = op.agentIds.map(id => agentById(id)).filter(Boolean) as NonNullable<typeof state.value>['agents']
    const power = agents.reduce((s, a) => s + a.power, 0)
    const rewardAgents = agents.map(a => ({
      level: a.level,
      class: a.class as AgentClass,
      traits: (a.traits ?? []) as AgentTrait[],
      items: ([a.gear?.tool, a.gear?.software, a.gear?.hardware] as any[])
        .filter(Boolean)
        .map((i: any) => ({ mods: i.mods as ItemMod[] }))
    }))
    const bonuses = collectBonuses(rewardAgents)
    return {
      op,
      template,
      preview: {
        successChance: opSuccessChance(power, template.minPower),
        cashRange: effectiveCashRange(template, bonuses),
        gemChance: effectiveGemChance(template, bonuses),
        gemBonus: bonuses.gemBonus,
        itemDropChance: effectiveItemDropChance(template, bonuses)
      }
    }
  })
)

const modalStats = computed(() => {
  if (!selectedTemplate.value || !state.value || selectedAgentIds.value.length === 0) return null
  const template = selectedTemplate.value
  const agents = selectedAgentIds.value
    .map(id => state.value!.agents.find(a => a.id === id))
    .filter(Boolean) as NonNullable<typeof state.value>['agents']
  const power = agents.reduce((s, a) => s + a.power, 0)
  const successChance = opSuccessChance(power, template.minPower)
  // Per-agent loadouts — collectBonuses / effectiveDurationMs fold in each agent's
  // gear, class and traits (loot capped per agent, speed compounded per agent), so
  // the preview matches the real reward roll.
  const rewardAgents = agents.map(a => ({
    level: a.level,
    class: a.class as AgentClass,
    traits: (a.traits ?? []) as AgentTrait[],
    items: ([a.gear?.tool, a.gear?.software, a.gear?.hardware] as any[])
      .filter(Boolean)
      .map((i: any) => ({ mods: i.mods as ItemMod[] }))
  }))
  const bonuses = collectBonuses(rewardAgents)
  const cashRange = effectiveCashRange(template, bonuses)
  const gemChance = effectiveGemChance(template, bonuses)
  const gemBonus = bonuses.gemBonus
  const itemDropChance = effectiveItemDropChance(template, bonuses)
  const durationMs = effectiveDurationMs(template, rewardAgents)
  // Full squad bonuses (class passives + traits + gear), summed by category — same
  // source of truth as the agent card's Total Bonuses, so the two always agree.
  const combinedMods = agentBonusStats(agents).map(s => ({ label: s.label, value: s.fmt(s.value) }))
  return { power, successChance, cashRange, gemChance, gemBonus, itemDropChance, durationMs, combinedMods }
})

// ── Mission board — every op template, always deployable. Sorted by money value
// (lowest first), optionally narrowed by the tier pill filter.
const sortedTemplates = computed(() => {
  if (!state.value) return []
  return [...state.value.opTemplates].sort(
    (a, b) => (a.baseCash[0] + a.baseCash[1]) - (b.baseCash[0] + b.baseCash[1])
  )
})
const filteredTemplates = computed(() =>
  tierFilter.value ? sortedTemplates.value.filter(t => missionTier(t.id) === tierFilter.value) : sortedTemplates.value)

// Thumbnails roll in gradually via scripts/generate-hack-images.ts — not every
// mission has one yet, so a 404 falls back to the plain icon tile per-card.
const thumbFailed = ref<Record<string, boolean>>({})
</script>

<template>
  <UContainer class="space-y-6 py-6 pb-12">
    <div
      v-if="!state"
      class="space-y-4"
    >
      <USkeleton
        v-for="i in 3"
        :key="i"
        class="h-28 rounded-xl"
      />
    </div>

    <!-- ═══ Mission board ═══════════════════════════════════════════════ -->
    <template v-else-if="!selectedTemplate">
      <div
        v-if="state.activeOps.length"
        class="space-y-3"
      >
        <h2 class="hack-eyebrow">
          // active operations — {{ state.activeOps.length }} running
        </h2>
        <HackFrame
          v-for="{ op, template, preview } in activeOpsPreview"
          :key="op.id"
          class="p-4"
        >
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div class="flex items-start gap-3 min-w-0">
              <div class="size-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <UIcon
                  :name="template?.icon ?? 'i-lucide-terminal'"
                  class="size-5 text-primary"
                />
              </div>
              <div class="min-w-0">
                <p class="font-semibold">
                  {{ template?.name }}
                </p>
                <div class="flex -space-x-2 mt-1.5">
                  <div
                    v-for="aid in op.agentIds"
                    :key="aid"
                    class="size-6 rounded-full ring-2 ring-default flex items-center justify-center text-[11px] font-bold text-black"
                    :class="avatarBg(agentById(aid)?.rarity as HackRarity ?? 'ghost')"
                    :title="agentById(aid)?.name"
                  >
                    {{ (agentById(aid)?.name ?? '?')[0] }}
                  </div>
                </div>
              </div>
            </div>
            <div class="text-right shrink-0">
              <template v-if="!isDone(op)">
                <p class="hack-stat-value-lg text-primary">
                  {{ formatMs(msLeft(op.completesAt)) }}
                </p>
                <p class="text-xs text-muted tabular-nums">
                  finishes ~{{ formatEndTime(op.completesAt) }}
                </p>
              </template>
              <UButton
                v-if="isDone(op)"
                size="sm"
                color="success"
                :loading="collecting === op.id"
                label="Collect"
                icon="i-lucide-download"
                @click="collect(op)"
              />
            </div>
          </div>

          <div
            v-if="preview"
            class="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm"
          >
            <span class="font-semibold text-yellow-400 tabular-nums">{{ cashRangeLabel(preview.cashRange) }}</span>
            <span
              v-if="preview.gemChance > 0 && template"
              class="text-cyan-400 tabular-nums"
            >
              {{ gemLabel(preview.gemChance, [template.baseGemCount[1] + preview.gemBonus, template.baseGemCount[1] + preview.gemBonus]) }}
            </span>
            <span
              v-if="template"
              class="flex items-center gap-1.5 tabular-nums"
            >
              <UIcon
                name="i-lucide-package"
                class="size-3.5 text-muted"
              />
              <span class="font-medium">{{ Math.round(preview.itemDropChance * 100) }}%</span>
              <UBadge
                size="xs"
                variant="subtle"
                :color="RARITY_COLOR[template.itemDropRarity as HackRarity]"
                :label="RARITY_LABEL[template.itemDropRarity as HackRarity]"
              />
            </span>
            <span
              class="flex items-center gap-1 ml-auto tabular-nums"
              :class="successColorClass(preview.successChance)"
            >
              <UIcon
                name="i-lucide-target"
                class="size-3.5"
              />
              <span class="font-semibold">{{ Math.round(preview.successChance * 100) }}%</span>
              <span class="text-muted font-normal text-xs">success</span>
            </span>
          </div>

          <div class="mt-3 flex items-center gap-3">
            <div class="flex-1 h-1.5 rounded-full bg-elevated overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-1000"
                :class="isDone(op) ? 'bg-success' : 'bg-primary'"
                :style="{ width: `${progressPct(op)}%` }"
              />
            </div>
            <span
              class="text-xs font-semibold tabular-nums w-9 text-right"
              :class="isDone(op) ? 'text-success' : 'text-muted'"
            >
              {{ isDone(op) ? '100%' : `${progressPct(op)}%` }}
            </span>
          </div>
        </HackFrame>
      </div>

      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="hack-eyebrow">
            // mission board
          </h2>
          <h1 class="text-2xl font-bold mt-1.5">
            Select an operation
          </h1>
          <p class="text-sm text-muted mt-1 max-w-xl">
            Below the power requirement just means worse odds — it never blocks a deploy.
            You can also run the same operation more than once at a time with different squads.
          </p>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <UButton
            size="xs"
            :color="!tierFilter ? 'primary' : 'neutral'"
            :variant="!tierFilter ? 'solid' : 'outline'"
            label="All"
            @click="tierFilter = null"
          />
          <UButton
            v-for="tier in TIER_ORDER"
            :key="tier"
            size="xs"
            :color="tierFilter === tier ? 'primary' : 'neutral'"
            :variant="tierFilter === tier ? 'solid' : 'outline'"
            :label="tier"
            @click="tierFilter = tier"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <HackFrame
          v-for="template in filteredTemplates"
          :key="template.id"
          role="button"
          tabindex="0"
          class="relative cursor-pointer transition-transform hover:-translate-y-0.5 hover:border-primary/50"
          @click="openBriefing(template)"
          @keydown.enter.space.prevent="openBriefing(template)"
        >
          <div class="h-28 bg-elevated/60 flex items-center justify-center relative border-b border-default overflow-hidden">
            <img
              v-if="!thumbFailed[template.id]"
              :src="missionThumbnail(template.id)"
              :alt="template.name"
              class="absolute inset-0 size-full object-cover"
              @error="thumbFailed[template.id] = true"
            >
            <UIcon
              v-else
              :name="template.icon"
              class="size-9 text-primary/40"
            />
            <UBadge
              size="md"
              class="absolute bottom-2 left-2"
              variant="subtle"
              :color="RARITY_COLOR[missionTierRarity(template.id)]"
              :label="missionTier(template.id)"
            />
            <span
              v-if="template.bestPower !== undefined && state.activeOps.some(o => o.templateId === template.id)"
              class="absolute top-2 right-2 text-[10px] font-mono px-2 py-0.5 rounded bg-background/85 border border-primary/40 text-primary"
            >● {{ state.activeOps.filter(o => o.templateId === template.id).length }} running</span>
          </div>
          <div class="p-4">
            <p class="font-bold text-[15px] leading-tight">
              {{ template.name }}
            </p>
            <p class="text-xs text-muted mt-1 min-h-[2.5em] line-clamp-2">
              {{ template.description }}
            </p>

            <div class="mt-3 space-y-1.5">
              <div class="flex justify-between text-xs pb-1.5 border-b border-dashed border-default">
                <span class="hack-stat-label-md">Payout (base)</span>
                <span class="text-yellow-400 font-medium">{{ cashRangeLabel(template.baseCash) }}</span>
              </div>
              <div class="flex justify-between text-xs pb-1.5 border-b border-dashed border-default">
                <span class="hack-stat-label-md">Gems (base)</span>
                <span class="text-cyan-400 font-medium">{{ gemLabel(template.baseGemChance, template.baseGemCount) }}</span>
              </div>
              <div class="flex justify-between text-xs pb-1.5 border-b border-dashed border-default">
                <span class="hack-stat-label-md">Power req.</span>
                <span class="font-medium">{{ template.minPower || 'Any' }}</span>
              </div>
              <div class="flex justify-between text-xs pb-1.5 border-b border-dashed border-default">
                <span class="hack-stat-label-md">Agents</span>
                <span class="font-medium">{{ agentRangeLabel(template.minAgents, template.maxAgents) }}</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="hack-stat-label-md">Time (base)</span>
                <span class="font-medium">{{ formatDuration(template.durationMs) }}</span>
              </div>
            </div>

            <p class="text-[10px] text-muted/70 mt-2 leading-snug">
              Base numbers — pick your squad on the briefing screen to see the recalculated payout, gems and success chance.
            </p>

            <div class="flex items-center justify-between mt-3 pt-3 border-t border-default">
              <span class="hack-stat-label-md">est. success, your best squad</span>
              <b
                class="text-sm"
                :class="successColorClass(template.effectiveSuccessChance)"
              >{{ Math.round(template.effectiveSuccessChance * 100) }}%</b>
            </div>
          </div>
        </HackFrame>
      </div>
    </template>

    <!-- ═══ Briefing overlay ═══════════════════════════════════════════ -->
    <template v-else>
      <button
        type="button"
        class="hack-eyebrow flex items-center gap-1.5 hover:text-primary transition-colors"
        @click="closeBriefing"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-3.5"
        />Mission Board
      </button>

      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <UBadge
            size="sm"
            variant="subtle"
            :color="RARITY_COLOR[missionTierRarity(selectedTemplate.id)]"
            :label="`${missionTier(selectedTemplate.id)} Tier`"
          />
          <h1 class="text-2xl font-bold mt-2">
            {{ selectedTemplate.name }}
          </h1>
          <p class="text-sm text-muted mt-1">
            {{ selectedTemplate.description }}
          </p>
        </div>
        <label class="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
          Skip briefing next time
          <USwitch v-model="skipBriefing" />
        </label>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5 items-start">
        <div class="space-y-4">
          <!-- Briefing player — auto-plays RELAY's line + synced caption -->
          <HackFrame
            accent
            class="relative aspect-video overflow-hidden flex items-end"
          >
            <div class="absolute inset-0 flex items-center justify-center bg-elevated/40">
              <UIcon
                :name="selectedTemplate.icon"
                class="size-16 text-primary/25"
              />
            </div>
            <div class="relative w-full p-4 bg-gradient-to-t from-background/95 via-background/50 to-transparent">
              <HackRelayCaption
                ref="briefingCaptionRef"
                :key="selectedTemplate.id"
                :voice-name="briefingVoice"
                :text="briefingText"
                :delay-ms="skipBriefing ? 0 : 300"
              />
            </div>
          </HackFrame>

          <!-- Squad select -->
          <HackFrame class="p-4">
            <div class="flex items-center justify-between mb-3">
              <h2 class="hack-eyebrow">
                Squad select
              </h2>
              <span class="text-xs text-muted">min {{ selectedTemplate.minAgents }}, max {{ selectedTemplate.maxAgents }}</span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <div
                v-for="agent in state.agents"
                :key="agent.id"
                class="hack-frame p-2.5 cursor-pointer transition-colors"
                :class="[
                  busyAgentIds.has(agent.id) ? 'opacity-40 cursor-not-allowed'
                  : selectedAgentIds.includes(agent.id) ? 'hack-frame-accent' : 'hover:border-primary/40'
                ]"
                @click="!busyAgentIds.has(agent.id) && toggleAgent(agent.id, selectedTemplate)"
              >
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-[13px]">{{ agent.name }}</span>
                  <UIcon
                    v-if="selectedAgentIds.includes(agent.id)"
                    name="i-lucide-check"
                    class="size-3.5 text-primary"
                  />
                </div>
                <p
                  class="text-[11px] mt-0.5"
                  :class="RARITY_STYLE[agent.rarity as HackRarity].text"
                >
                  {{ RARITY_LABEL[agent.rarity as HackRarity] }} · {{ CLASS_LABEL[agent.class as AgentClass] }}
                </p>
                <p class="text-xs text-primary font-medium mt-1.5">
                  PWR {{ agent.power }}
                </p>
              </div>
            </div>

            <template v-if="modalStats">
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div>
                  <p class="hack-eyebrow">
                    Combined power
                  </p>
                  <p class="hack-stat-value-lg text-primary mt-1">
                    {{ modalStats.power }}
                  </p>
                </div>
                <div>
                  <p class="hack-eyebrow">
                    Effective time
                  </p>
                  <p class="hack-stat-value-lg mt-1">
                    {{ formatMs(modalStats.durationMs) }}
                  </p>
                </div>
                <div>
                  <p class="hack-eyebrow">
                    Cash est.
                  </p>
                  <p class="hack-stat-value-lg text-yellow-400 mt-1">
                    {{ cashRangeLabel(modalStats.cashRange) }}
                  </p>
                </div>
                <div>
                  <p class="hack-eyebrow">
                    Gem chance
                  </p>
                  <p class="hack-stat-value-lg text-cyan-400 mt-1">
                    {{ Math.round(modalStats.gemChance * 100) }}%
                  </p>
                </div>
              </div>

              <div
                v-if="modalStats.combinedMods.length"
                class="mb-4"
              >
                <p class="hack-eyebrow mb-2">
                  Agent modifiers
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <HackModChip
                    v-for="mod in modalStats.combinedMods"
                    :key="mod.label"
                    :label="mod.label"
                    :value="mod.value"
                  />
                </div>
              </div>

              <p class="hack-eyebrow mb-1.5">
                Success chance
              </p>
              <div class="h-2.5 rounded-full bg-elevated overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="modalStats.successChance < 0.31 ? 'bg-error' : modalStats.successChance < 0.69 ? 'bg-warning' : 'bg-success'"
                  :style="{ width: `${Math.min(100, Math.round(modalStats.successChance * 100))}%` }"
                />
              </div>
            </template>

            <div class="flex items-center justify-between mt-4">
              <span class="text-xs text-muted">{{ selectedAgentIds.length }}/{{ selectedTemplate.maxAgents }} agents selected</span>
              <UButton
                label="Deploy Squad"
                icon="i-lucide-send"
                :loading="dispatching"
                :disabled="selectedAgentIds.length < selectedTemplate.minAgents || !modalStats || modalStats.successChance < MIN_DEPLOY_SUCCESS"
                @click="audio.playSfx('click'); dispatch()"
              />
            </div>
            <p
              v-if="modalStats && modalStats.successChance < MIN_DEPLOY_SUCCESS"
              class="text-sm text-error mt-2"
            >
              Success chance too low to deploy — your squad isn't ready.
              <NuxtLink to="/hack/loadout" class="underline hover:text-error/80">Gear up in Loadout →</NuxtLink>
            </p>
          </HackFrame>
        </div>

        <!-- Dossier spec sheet -->
        <HackFrame class="p-4 space-y-0.5">
          <h2 class="hack-eyebrow mb-2">
            Mission dossier
          </h2>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Duration (base)</span><span>{{ formatDuration(selectedTemplate.durationMs) }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Agents required</span><span>{{ agentRangeLabel(selectedTemplate.minAgents, selectedTemplate.maxAgents) }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Min. squad power</span><span>{{ selectedTemplate.minPower || 'None' }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Cash reward (base)</span><span class="text-yellow-400">{{ cashRangeLabel(selectedTemplate.baseCash) }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Base XP</span><span class="text-violet-400">{{ selectedTemplate.baseXP }} / agent</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Gem chance (base)</span><span class="text-cyan-400">{{ gemLabel(selectedTemplate.baseGemChance, selectedTemplate.baseGemCount) }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Item drop chance</span><span>{{ Math.round(selectedTemplate.itemDropChance * 100) }}%</span>
          </div>
          <div class="flex justify-between text-sm py-1.5">
            <span class="text-muted">Item rarity floor</span>
            <span :class="RARITY_STYLE[selectedTemplate.itemDropRarity as HackRarity].text">{{ RARITY_LABEL[selectedTemplate.itemDropRarity as HackRarity] }}</span>
          </div>
          <p class="text-xs text-muted/70 mt-3 pt-3 border-t border-default leading-relaxed">
            Numbers shown reflect your currently selected squad, computed live from the same
            formulas as the deploy call — what you see here is exactly what you'll get.
          </p>
        </HackFrame>
      </div>
    </template>

    <!-- Collect reveal — same flash/stamp/reveal cinematic as a Black Market pull -->
    <HackCollectReveal
      v-if="collectResult"
      v-model:open="collectModalOpen"
      :result="collectResult"
      :voice-name="collectLine.voice"
      :voice-text="collectLine.text"
    />
  </UContainer>
</template>
