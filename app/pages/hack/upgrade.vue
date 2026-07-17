<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, RARITY_STYLE, RARITY_ORDER, CLASS_LABEL, CLASS_ICON, CLASS_PASSIVE,
  AGENT_TRAIT_LABEL, AGENT_TRAIT_RANGES, formatTraitValue, formatArtifactAdd, rollPct, ARTIFACT_VALUE,
  type HackRarity, type AgentClass, type AgentTraitType
} from '#shared/utils/hack-config'
import { LOADOUT_SWAP, pickVoiceLine, type VoiceEntry } from '~/utils/hack-voice-lines'
import type { VoiceHandle } from '~/composables/useAudio'

type Agent = {
  id: string
  name: string
  class: AgentClass
  rarity: HackRarity
  level: number
  power: number
  traits: AgentTrait[]
  active: boolean
}

type Artifact = {
  id: string
  traitType: AgentTraitType
  rarity: HackRarity
  count: number
}

type AgentTrait = { type: AgentTraitType; value: number }

const ALL_TRAIT_TYPES: AgentTraitType[] = [
  'gem_chance',
  'speed_percent',
  'loot_percent',
  'xp_boost',
  'power_flat',
  'power_percent',
  'gem_bonus',
]

const route = useRoute()
const router = useRouter()
const toast = useToast()
const audio = useAudio('hack')
const { data: state, refresh } = await useFetch('/api/hack/state')

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
    if (agentSortBy.value === 'power') return b.power - a.power
    if (agentSortBy.value === 'level') return b.level - a.level
    const r = RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
    return r !== 0 ? r : b.power - a.power
  })
  return agents
})
const sortedActiveAgents = computed(() => roster.value.filter(a => a.active))
const sortedStoredAgents = computed(() => roster.value.filter(a => !a.active))

const selectedAgentId = ref<string | null>((route.query.agent as string) ?? null)
watch(roster, (list) => {
  if (!list.some(a => a.id === selectedAgentId.value)) selectedAgentId.value = list[0]?.id ?? null
}, { immediate: true })

const selectedAgent = computed(() => roster.value.find(a => a.id === selectedAgentId.value) ?? null)
function selectAgent(id: string) {
  selectedAgentId.value = id
  router.replace({ query: { ...route.query, agent: id } })
  selectedArtifactId.value = null
}

const artifacts = computed<Artifact[]>(() => (state.value?.artifacts ?? []) as Artifact[])
const selectedArtifactId = ref<string | null>(null)
const selectedArtifact = computed(() => artifacts.value.find(a => a.id === selectedArtifactId.value) ?? null)

function agentTraitValue(agent: Agent, type: AgentTraitType) {
  return agent.traits.find(t => t.type === type)?.value ?? null
}

function projectedValue(type: AgentTraitType, current: number | null) {
  if (current === null || !selectedArtifact.value) return null
  if (selectedArtifact.value.traitType !== type) return null
  const range = AGENT_TRAIT_RANGES[type]
  const add = ARTIFACT_VALUE[type][selectedArtifact.value.rarity]
  return Math.min(range.max, current + add)
}

function isMaxed(type: AgentTraitType, current: number | null) {
  if (current === null) return false
  return current >= AGENT_TRAIT_RANGES[type].max
}

const sortedTraits = computed(() => {
  if (!selectedAgent.value) return [] as AgentTrait[]
  const priority: AgentTraitType[] = ['power_flat', 'power_percent', 'xp_boost', 'speed_percent', 'loot_percent', 'gem_chance', 'gem_bonus']
  const traits = [...selectedAgent.value.traits]
  traits.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type))
  return traits
})

const selectedArtifactUsable = computed(() => {
  if (!selectedAgent.value || !selectedArtifact.value) return false
  const current = agentTraitValue(selectedAgent.value, selectedArtifact.value.traitType)
  if (current === null) return false
  return !isMaxed(selectedArtifact.value.traitType, current)
})

const applyDelta = computed(() => {
  if (!selectedAgent.value || !selectedArtifact.value) return null
  const type = selectedArtifact.value.traitType
  const current = agentTraitValue(selectedAgent.value, type)
  if (current === null) return null
  const range = AGENT_TRAIT_RANGES[type]
  const add = ARTIFACT_VALUE[type][selectedArtifact.value.rarity]
  const projected = Math.min(range.max, current + add)
  return { type, current, projected, hitCap: projected < current + add, range, rarity: selectedArtifact.value.rarity }
})

const applying = ref(false)
async function confirmApply() {
  if (!selectedAgent.value || !selectedArtifact.value) return
  applying.value = true
  try {
    await $fetch('/api/hack/artifacts/apply', {
      method: 'POST',
      body: { agentId: selectedAgent.value.id, artifactId: selectedArtifact.value.id }
    })
    audio.playSfx('loadout-lock')
    relayBark(LOADOUT_SWAP)
    toast.add({ title: 'Artifact applied', color: 'success' })
    selectedArtifactId.value = null
    await refresh()
  } catch (e: unknown) {
    audio.playSfx('deny')
    toast.add({ title: apiErrorMessage(e, 'Apply failed'), color: 'error' })
  } finally { applying.value = false }
}

function selectArtifact(id: string) {
  selectedArtifactId.value = selectedArtifactId.value === id ? null : id
}

function clearSelectedArtifact() {
  selectedArtifactId.value = null
}

function toggleHideUnusable() {
  hideUnusable.value = !hideUnusable.value
}

function traitRowClasses(type: AgentTraitType, current: number | null, projected: number | null) {
  const targetable = projected !== null && current !== null && projected > current
  return {
    'border-primary': targetable,
    'bg-primary/5': targetable,
    'border-default': !targetable,
    'opacity-50': isMaxed(type, current)
  }
}

// Inventory filters and "hide unusable" toggle
const hideUnusable = ref(true)
const rarityFilter = ref<string>('all')
const traitFilter = ref<string>('all')

const rarityFilterOptions = [
  { value: 'all', label: 'All rarities' },
  ...RARITY_ORDER.map(r => ({ value: r, label: RARITY_LABEL[r] }))
]
const traitFilterOptions = [
  { value: 'all', label: 'All traits' },
  ...ALL_TRAIT_TYPES.map(t => ({ value: t, label: AGENT_TRAIT_LABEL[t] }))
]

function isArtifactApplicable(artifact: Artifact) {
  if (!selectedAgent.value) return false
  const current = agentTraitValue(selectedAgent.value, artifact.traitType)
  if (current === null) return false
  return !isMaxed(artifact.traitType, current)
}

const filteredArtifacts = computed(() => {
  let list = [...artifacts.value]
  if (rarityFilter.value !== 'all') list = list.filter(a => a.rarity === rarityFilter.value)
  if (traitFilter.value !== 'all') list = list.filter(a => a.traitType === traitFilter.value)
  if (hideUnusable.value) list = list.filter(a => isArtifactApplicable(a))
  list.sort((a, b) => {
    const r = RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
    if (r !== 0) return r
    const nameA = AGENT_TRAIT_LABEL[a.traitType]
    const nameB = AGENT_TRAIT_LABEL[b.traitType]
    return nameA.localeCompare(nameB)
  })
  return list
})
</script>

<template>
  <div class="p-6 pb-12 overflow-y-auto h-full">
    <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
      <div>
        <p class="hack-eyebrow">
          // agent upgrade
        </p>
        <h1 class="text-2xl font-bold mt-1.5">
          Artifacts
        </h1>
        <p class="text-sm text-muted mt-1 max-w-xl">
          Push a rolled trait toward its cap. One Artifact, one application. Artifacts drop from successful ops.
        </p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-users"
        label="Back to Agents"
        to="/hack/agents"
      />
    </div>

    <div
      v-if="!state"
      class="grid grid-cols-1"
    >
      <USkeleton class="h-96 rounded-xl" />
    </div>

    <div
      v-else
      class="grid grid-cols-1 xl:grid-cols-[280px_1fr_380px] gap-6 items-start"
    >
      <!-- ── Roster sidebar ─────────────────────────────────────────── -->
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
            <HackAgentAvatar
              class="size-10 shrink-0"
              :name="a.name"
              :rarity="a.rarity"
            />
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
            <HackAgentAvatar
              class="size-10 shrink-0"
              :name="a.name"
              :rarity="a.rarity"
            />
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
        <p
          v-if="!state?.agents.length && !state?.storedAgents.length"
          class="text-sm text-muted px-3.5 py-8 text-center"
        >
          No agents to upgrade.
        </p>
      </HackFrame>

      <!-- ── Center: agent traits ─────────────────────────────────── -->
      <HackFrame
        v-if="selectedAgent"
        accent
        class="p-6"
      >
        <div class="text-center mb-6">
          <HackAgentAvatar
            class="size-32 mx-auto mb-4"
            :name="selectedAgent.name"
            :rarity="selectedAgent.rarity"
          />
          <div class="flex items-center justify-center gap-2 flex-wrap">
            <span class="font-bold text-2xl">{{ selectedAgent.name }}</span>
            <UBadge
              :color="RARITY_COLOR[selectedAgent.rarity]"
              variant="subtle"
              :label="RARITY_LABEL[selectedAgent.rarity]"
            />
          </div>
          <p class="text-sm text-muted font-mono mt-1.5">
            <UIcon
              :name="CLASS_ICON[selectedAgent.class]"
              class="size-3.5"
            />
            {{ CLASS_LABEL[selectedAgent.class] }} · Lv {{ selectedAgent.level }} ·
            <span class="text-primary font-semibold">PWR {{ selectedAgent.power }}</span>
          </p>
          <p class="text-xs text-muted font-mono mt-1">
            Class passive {{ CLASS_PASSIVE[selectedAgent.class].label }} — Artifacts never touch it.
          </p>
        </div>

        <p class="hack-stat-label-md mb-3">
          Rolled traits <span class="text-muted normal-case tracking-normal">— select an Artifact on the right to preview</span>
        </p>

        <div
          v-for="t in sortedTraits"
          :key="t.type"
          class="p-4 border mb-2.5 transition-colors"
          :class="traitRowClasses(t.type, t.value, projectedValue(t.type, t.value))"
        >
          <div class="flex items-center justify-between mb-2.5">
            <span class="font-semibold text-sm">{{ AGENT_TRAIT_LABEL[t.type] }}</span>
            <span class="font-mono font-bold text-sm">
              {{ formatTraitValue(t.type, t.value) }}
              <template v-if="projectedValue(t.type, t.value) !== null && projectedValue(t.type, t.value)! > t.value">
                <span class="text-muted mx-1">→</span>
                <span class="text-primary">{{ formatTraitValue(t.type, projectedValue(t.type, t.value)!) }}</span>
              </template>
              <UBadge
                v-if="isMaxed(t.type, t.value)"
                size="xs"
                color="warning"
                variant="subtle"
                class="ml-2"
                label="Maxed"
              />
            </span>
          </div>

          <div class="flex items-center gap-3">
            <span class="font-mono text-[11px] text-muted min-w-0">
              min <b class="text-muted">{{ formatTraitValue(t.type, AGENT_TRAIT_RANGES[t.type].min).replace('+', '') }}</b>
            </span>
            <div class="hack-range-bar flex-1">
              <div
                class="hack-range-fill"
                :style="{ width: `${rollPct(AGENT_TRAIT_RANGES[t.type], t.value)}%` }"
              />
              <div
                class="hack-range-marker"
                :style="{ left: `${rollPct(AGENT_TRAIT_RANGES[t.type], t.value)}%` }"
              />
              <div
                v-if="projectedValue(t.type, t.value) !== null && projectedValue(t.type, t.value)! > t.value"
                class="absolute top-0 left-0 h-full bg-primary/50"
                :style="{ width: `${rollPct(AGENT_TRAIT_RANGES[t.type], projectedValue(t.type, t.value) ?? t.value)}%` }"
              />
              <div
                v-if="projectedValue(t.type, t.value) !== null && projectedValue(t.type, t.value)! > t.value"
                class="hack-range-marker bg-primary"
                :style="{ left: `${rollPct(AGENT_TRAIT_RANGES[t.type], projectedValue(t.type, t.value) ?? t.value)}%` }"
              />
            </div>
            <span class="font-mono text-[11px] text-muted min-w-0">
              max <b class="text-muted">{{ formatTraitValue(t.type, AGENT_TRAIT_RANGES[t.type].max).replace('+', '') }}</b>
            </span>
          </div>
        </div>

        <p class="text-xs text-muted font-mono mt-2">
          Only rolled traits are shown — Artifacts can't add a trait type this agent never rolled.
        </p>
      </HackFrame>

      <div
        v-else
        class="hack-frame p-8 text-center text-muted"
      >
        No agent selected.
      </div>

      <!-- ── Inventory sidebar ─────────────────────────────────────── -->
      <HackFrame class="p-4">
        <div class="flex items-center justify-between gap-2 mb-3">
          <h2 class="hack-stat-label-md">
            Artifact inventory <span class="text-muted normal-case tracking-normal">— {{ filteredArtifacts.reduce((s, a) => s + a.count, 0) }} shown / {{ artifacts.reduce((s, a) => s + a.count, 0) }} total</span>
          </h2>
          <UButton
            :icon="hideUnusable ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :color="hideUnusable ? 'primary' : 'neutral'"
            variant="ghost"
            size="xs"
            @click="toggleHideUnusable"
          />
        </div>

        <div class="flex gap-1.5 mb-4">
          <div class="flex-1 min-w-0">
            <USelect
              v-model="rarityFilter"
              :items="rarityFilterOptions"
              size="xs"
              class="w-full"
            />
          </div>
          <div class="flex-1 min-w-0">
            <USelect
              v-model="traitFilter"
              :items="traitFilterOptions"
              size="xs"
              class="w-full"
            />
          </div>
        </div>

        <div
          v-if="!filteredArtifacts.length"
          class="text-sm text-muted text-center py-8"
        >
          <UIcon
            name="i-lucide-package-open"
            class="size-8 mx-auto mb-2 opacity-30"
          />
          No matching artifacts.
        </div>
        <div
          v-else
          class="space-y-2 max-h-[62vh] overflow-y-auto pr-1"
        >
          <button
            v-for="artifact in filteredArtifacts"
            :key="artifact.id"
            type="button"
            class="w-full flex items-center gap-3 p-3 border transition-colors text-left"
            :class="[
              selectedArtifactId === artifact.id ? 'border-primary bg-primary/10' : 'border-default hover:border-primary/50',
              !isArtifactApplicable(artifact) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
            ]"
            :disabled="!isArtifactApplicable(artifact)"
            @click="selectArtifact(artifact.id)"
          >
            <div
              class="size-9 shrink-0 flex items-center justify-center border"
              :class="[RARITY_STYLE[artifact.rarity].border, RARITY_STYLE[artifact.rarity].text, RARITY_STYLE[artifact.rarity].bg]"
            >
              <UIcon
                name="i-lucide-zap"
                class="size-4"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-sm">{{ AGENT_TRAIT_LABEL[artifact.traitType] }} Artifact</span>
                <UBadge
                  size="xs"
                  :color="RARITY_COLOR[artifact.rarity]"
                  variant="subtle"
                  :label="RARITY_LABEL[artifact.rarity]"
                />
              </div>
              <p class="text-xs text-muted font-mono mt-0.5">
                <span v-if="selectedAgent && agentTraitValue(selectedAgent, artifact.traitType) === null">
                  {{ selectedAgent.name }} has no {{ AGENT_TRAIT_LABEL[artifact.traitType] }} trait
                </span>
                <span v-else-if="selectedAgent && isMaxed(artifact.traitType, agentTraitValue(selectedAgent, artifact.traitType))">
                  {{ AGENT_TRAIT_LABEL[artifact.traitType] }} already maxed
                </span>
                <span v-else>
                  adds <span class="text-primary font-semibold">{{ formatArtifactAdd(artifact.traitType, ARTIFACT_VALUE[artifact.traitType][artifact.rarity]).replace('+', '') }}</span> to {{ AGENT_TRAIT_LABEL[artifact.traitType] }}
                </span>
              </p>
            </div>
            <span class="font-mono text-xs text-muted">×{{ artifact.count }}</span>
          </button>
        </div>

        <div
          v-if="applyDelta"
          class="border-t border-default mt-4 pt-4"
        >
          <p class="hack-stat-label-md mb-2">
            Preview
          </p>
          <div class="flex items-center justify-between text-sm py-2 border-b border-default last:border-none">
            <span>{{ AGENT_TRAIT_LABEL[applyDelta.type] }}</span>
            <span class="font-semibold text-primary">
              {{ formatTraitValue(applyDelta.type, applyDelta.current) }} → {{ formatTraitValue(applyDelta.type, applyDelta.projected) }}
              <span
                v-if="applyDelta.hitCap"
                class="text-warning"
              > (hit cap)</span>
              <span v-else> ({{ formatArtifactAdd(applyDelta.type, applyDelta.projected - applyDelta.current) }})</span>
            </span>
          </div>

          <div class="flex items-center justify-between gap-3 mt-4">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="clearSelectedArtifact"
            />
            <UButton
              color="primary"
              :loading="applying"
              :disabled="!selectedArtifactUsable"
              @click="confirmApply"
            >
              Apply Artifact
            </UButton>
          </div>
        </div>
      </HackFrame>
    </div>
  </div>
</template>

