<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_STYLE, CLASS_LABEL,
  agentBonusStats,
  effectiveDurationMs, collectBonuses, effectiveCashRange, effectiveGemChance, effectiveItemDropChance, opSuccessChance, MIN_DEPLOY_SUCCESS,
  type HackRarity, type AgentClass, type AgentTrait, type ItemMod
} from '#shared/utils/hack-config'
import type { VoiceHandle } from '~/composables/useAudio'

const route = useRoute()
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()
const audio = useAudio('hack')

const template = computed(() =>
  state.value?.opTemplates.find(t => missionSlug(t.id) === route.params.slug) ?? null)

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
function gemAmountLabel(count: [number, number], bonus: number) {
  const lo = count[0] + bonus
  const hi = count[1] + bonus
  return lo === hi ? String(lo) : `${lo} – ${hi}`
}

const selectedAgentIds = ref<string[]>([])
const dispatching = ref(false)

// "Skip briefing next time" — persisted, removes the pre-roll pause on VO/caption
// playback for players who've already heard the line (mirrors the crate "quick
// open" toggle). Squad-select itself is never gated on the briefing finishing.
const skipBriefing = ref(false)
onMounted(() => {
  const saved = localStorage.getItem('hack-skip-briefing')
  if (saved !== null) skipBriefing.value = saved === 'true'
  audio.playSfx('briefing-open')
})
watch(skipBriefing, v => localStorage.setItem('hack-skip-briefing', String(v)))

const briefingVoice = computed(() => template.value ? missionVoice(template.value.id) : '')
const briefingText = computed(() => template.value ? missionBriefing(template.value.id) : '')
const briefingCaptionRef = ref<{ stop: () => void } | null>(null)
// While the briefing VO is still playing, suppress the squad-select outro so the
// two lines don't talk over each other. Cleared when the caption — paced to the
// clip's real length — finishes (`@ended`), or when the page is left.
const briefingPlaying = ref(true)

// The "pick your people" outro line — plays once per visit, on the first
// squad selection.
let outroPlayed = false
let outroHandle: VoiceHandle | null = null

function toggleAgent(id: string) {
  if (!template.value) return
  const idx = selectedAgentIds.value.indexOf(id)
  if (idx >= 0) {
    selectedAgentIds.value.splice(idx, 1)
  } else if (selectedAgentIds.value.length < template.value.maxAgents) {
    selectedAgentIds.value.push(id)
  }
  // Don't let the squad-select outro play over a briefing that's still running.
  // It simply doesn't fire in that case; a later pick after the briefing has
  // finished still gets it, since outroPlayed stays false here.
  if (!outroPlayed && !briefingPlaying.value && selectedAgentIds.value.length > 0) {
    outroPlayed = true
    outroHandle = audio.playVoice(pickVoiceLine(BRIEF_OUTRO).voice, { delayMs: 200 })
  }
}

onBeforeUnmount(() => {
  briefingCaptionRef.value?.stop()
  outroHandle?.cancel()
})

async function dispatch() {
  if (!template.value) return
  // Stop the briefing/outro VO immediately on click rather than waiting for
  // the request to resolve — clicking Deploy is the player's own signal that
  // they're done listening.
  briefingCaptionRef.value?.stop()
  outroHandle?.cancel()
  briefingPlaying.value = false
  dispatching.value = true
  try {
    await $fetch('/api/hack/ops/dispatch', {
      method: 'POST',
      body: { templateId: template.value.id, agentIds: selectedAgentIds.value }
    })
    audio.playSfx('deploy-confirm')
    toast.add({ title: `Op dispatched`, description: template.value.name, color: 'success' })
    await refresh()
    await navigateTo('/hack')
  } catch (e: any) {
    audio.playSfx('deny')
    toast.add({ title: apiErrorMessage(e, 'Dispatch failed'), color: 'error' })
  } finally {
    dispatching.value = false
  }
}

const busyAgentIds = computed(() =>
  new Set(state.value?.activeOps.flatMap(o => o.agentIds) ?? [])
)

const modalStats = computed(() => {
  if (!template.value || !state.value || selectedAgentIds.value.length === 0) return null
  const t = template.value
  const agents = selectedAgentIds.value
    .map(id => state.value!.agents.find(a => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map(a => ({ ...a, class: a.class as AgentClass }))
  const power = agents.reduce((s, a) => s + a.power, 0)
  const successChance = opSuccessChance(power, t.minPower)
  // Per-agent loadouts — collectBonuses / effectiveDurationMs fold in each agent's
  // gear, class and traits (loot capped per agent, speed compounded per agent), so
  // the preview matches the real reward roll.
  const rewardAgents = agents.map(a => ({
    level: a.level,
    class: a.class,
    traits: (a.traits ?? []) as AgentTrait[],
    items: ([a.gear?.tool, a.gear?.software, a.gear?.hardware] as any[])
      .filter(Boolean)
      .map((i: any) => ({ mods: i.mods as ItemMod[] }))
  }))
  const bonuses = collectBonuses(rewardAgents)
  const cashRange = effectiveCashRange(t, bonuses)
  const gemChance = effectiveGemChance(t, bonuses)
  const gemBonus = bonuses.gemBonus
  const itemDropChance = effectiveItemDropChance(t, bonuses)
  const durationMs = effectiveDurationMs(t, rewardAgents)
  // Full squad bonuses (class passives + traits + gear), summed by category — same
  // source of truth as the agent card's Total Bonuses, so the two always agree.
  const combinedMods = agentBonusStats(agents).map(s => ({ label: s.label, value: s.fmt(s.value) }))
  return { power, successChance, cashRange, gemChance, gemBonus, itemDropChance, durationMs, combinedMods }
})

const thumbFailed = ref(false)
</script>

<template>
  <UContainer class="space-y-6 py-6 pb-12">
    <div
      v-if="!state"
      class="space-y-4"
    >
      <USkeleton class="h-8 w-40 rounded" />
      <USkeleton class="h-64 rounded-xl" />
    </div>

    <div
      v-else-if="!template"
      class="text-center py-16 space-y-3"
    >
      <UIcon
        name="i-lucide-file-question"
        class="size-10 text-muted mx-auto"
      />
      <p class="text-muted">
        No such operation.
      </p>
      <UButton
        to="/hack"
        variant="subtle"
        icon="i-lucide-arrow-left"
        label="Back to Mission Board"
      />
    </div>

    <template v-else>
      <NuxtLink
        to="/hack"
        class="hack-eyebrow flex items-center gap-1.5 hover:text-primary transition-colors w-fit"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-3.5"
        />Mission Board
      </NuxtLink>

      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <UBadge
            size="sm"
            variant="subtle"
            :color="RARITY_COLOR[missionTierRarity(template.id)]"
            :label="`${missionTier(template.id)} Tier`"
          />
          <h1 class="text-2xl font-bold mt-2">
            {{ template.name }}
          </h1>
          <p class="text-sm text-muted mt-1">
            {{ template.description }}
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
            <div class="absolute inset-0 bg-elevated/40">
              <img
                v-if="!thumbFailed"
                :src="missionThumbnail(template.id)"
                :alt="template.name"
                class="size-full object-cover"
                @error="thumbFailed = true"
              >
              <div
                v-else
                class="size-full flex items-center justify-center"
              >
                <UIcon
                  :name="template.icon"
                  class="size-16 text-primary/25"
                />
              </div>
            </div>
            <div class="relative w-full p-4 bg-gradient-to-t from-background/95 via-background/60 to-transparent">
              <HackRelayCaption
                ref="briefingCaptionRef"
                :key="template.id"
                :voice-name="briefingVoice"
                :text="briefingText"
                :delay-ms="skipBriefing ? 0 : 300"
                @ended="briefingPlaying = false"
              />
            </div>
          </HackFrame>

          <!-- Squad select -->
          <HackFrame class="p-4">
            <div class="flex items-center justify-between mb-3">
              <h2 class="hack-eyebrow">
                Squad select
              </h2>
              <span class="text-xs text-muted">min {{ template.minAgents }}, max {{ template.maxAgents }}</span>
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
                @click="!busyAgentIds.has(agent.id) && toggleAgent(agent.id)"
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
                    Gems
                  </p>
                  <p class="hack-stat-value-lg text-cyan-400 mt-1 tabular-nums">
                    <template v-if="template.baseGemChance > 0">
                      {{ gemAmountLabel(template.baseGemCount, modalStats.gemBonus) }}
                      <span class="text-cyan-400/60 text-xs font-normal">({{ Math.round(modalStats.gemChance * 100) }}%)</span>
                    </template>
                    <template v-else>
                      None
                    </template>
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

              <div class="flex items-center justify-between mb-1.5">
                <p class="hack-eyebrow">
                  Success chance
                </p>
                <span
                  class="text-sm font-semibold tabular-nums"
                  :class="modalStats.successChance < 0.31 ? 'text-error' : modalStats.successChance < 0.69 ? 'text-warning' : 'text-success'"
                >{{ Math.round(modalStats.successChance * 100) }}%</span>
              </div>
              <div class="h-2.5 rounded-full bg-elevated overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="modalStats.successChance < 0.31 ? 'bg-error' : modalStats.successChance < 0.69 ? 'bg-warning' : 'bg-success'"
                  :style="{ width: `${Math.min(100, Math.round(modalStats.successChance * 100))}%` }"
                />
              </div>
            </template>

            <div class="flex items-center justify-between mt-4">
              <span class="text-xs text-muted">{{ selectedAgentIds.length }}/{{ template.maxAgents }} agents selected</span>
              <UButton
                label="Deploy Squad"
                icon="i-lucide-send"
                :loading="dispatching"
                :disabled="selectedAgentIds.length < template.minAgents || !modalStats || modalStats.successChance < MIN_DEPLOY_SUCCESS"
                @click="audio.playSfx('click'); dispatch()"
              />
            </div>
            <p
              v-if="modalStats && modalStats.successChance < MIN_DEPLOY_SUCCESS"
              class="text-sm text-error mt-2"
            >
              Success chance too low to deploy — your squad isn't ready.
              <NuxtLink
                to="/hack/loadout"
                class="underline hover:text-error/80"
              >Gear up in Loadout →</NuxtLink>
            </p>
          </HackFrame>
        </div>

        <!-- Dossier spec sheet -->
        <HackFrame class="p-4 space-y-0.5">
          <h2 class="hack-eyebrow mb-2">
            Mission dossier
          </h2>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Duration (base)</span><span>{{ formatDuration(template.durationMs) }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Agents required</span><span>{{ agentRangeLabel(template.minAgents, template.maxAgents) }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Min. squad power</span><span>{{ template.minPower || 'None' }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Cash reward (base)</span><span class="text-yellow-400">{{ cashRangeLabel(template.baseCash) }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Base XP</span><span class="text-violet-400">{{ template.baseXP }} / agent</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Gem chance (base)</span><span class="text-cyan-400">{{ gemLabel(template.baseGemChance, template.baseGemCount) }}</span>
          </div>
          <div class="flex justify-between text-sm py-1.5 border-b border-default">
            <span class="text-muted">Item drop chance</span><span>{{ Math.round(template.itemDropChance * 100) }}%</span>
          </div>
          <div class="flex justify-between text-sm py-1.5">
            <span class="text-muted">Item rarity floor</span>
            <span :class="RARITY_STYLE[template.itemDropRarity as HackRarity].text">{{ RARITY_LABEL[template.itemDropRarity as HackRarity] }}</span>
          </div>
          <p class="text-xs text-muted/70 mt-3 pt-3 border-t border-default leading-relaxed">
            Numbers shown reflect your currently selected squad, computed live from the same
            formulas as the deploy call — what you see here is exactly what you'll get.
          </p>
        </HackFrame>
      </div>
    </template>
  </UContainer>
</template>
