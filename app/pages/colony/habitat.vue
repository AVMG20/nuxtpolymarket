<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getItem, BUG_TYPES, HABITAT_BUILDER_JOB_ID, TIER_NAMES } from '#shared/utils/colony'
import { tierColor } from '#shared/utils/xeno'
import { formatDuration, progressPct } from '~/lib/colony-format'

const TOOLTIP_CONTENT_UI = 'h-auto max-w-64 p-3 flex-col items-start bg-default ring ring-default rounded-lg shadow-lg z-50'

function foragedBy(itemId: string) {
  return BUG_TYPES.find(b => b.itemId === itemId)
}

const colony = useColony()
const { upgrades, builders, builderCount, buildersFree, busyTrackIds, inventory, habitatLevel, maxTier, habitatLevelUpCost, habitatLevelUpDurationMs, habitatLevelUpGemCost } = colony
const sound = useColonySound()
const fx = useColonyFx()

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

const now = ref(Date.now())
let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  interval = setInterval(() => { now.value = Date.now() }, 500)
})
onUnmounted(() => {
  if (interval) clearInterval(interval)
})

type BuilderJob = typeof builders.value[number]
type UpgradeTrack = typeof upgrades.value[number]

function jobReady(job: BuilderJob) {
  return now.value >= new Date(job.completesAt).getTime()
}

const builderSlots = computed<{ key: string, job: BuilderJob | null }[]>(() => [
  ...builders.value.map(job => ({ key: job.id, job })),
  ...Array.from({ length: buildersFree.value }, (_, i) => ({ key: `idle-${i}`, job: null }))
])

const tracksMeetingRequirement = computed(() => upgrades.value.filter((t: any) => t.meetsHabitatRequirement).length)
const habitatUpgradeReady = computed(() => tracksMeetingRequirement.value === upgrades.value.length && upgrades.value.length > 0)
const canAffordHabitatLevelUp = computed(() =>
  habitatLevelUpCost.value !== null
  && balance.value >= habitatLevelUpCost.value
  && gems.value >= (habitatLevelUpGemCost.value ?? 0)
)
const habitatUnderConstruction = computed(() => busyTrackIds.value.has(HABITAT_BUILDER_JOB_ID))
const canStartHabitatLevelUp = computed(() =>
  habitatUpgradeReady.value
  && canAffordHabitatLevelUp.value
  && !habitatUnderConstruction.value
  && buildersFree.value > 0
)

function buildBlockedReason(track: UpgradeTrack): string | null {
  if (busyTrackIds.value.has(track.id)) return 'Under construction'
  if (buildersFree.value === 0) return builderCount.value === 1 ? 'Builder busy' : 'All builders busy'
  if (!affordCost(track.nextCost)) return 'Not enough resources'
  return null
}

function ownedQty(itemTypeId: string) {
  const owned = inventory.value.find((i: any) => i.id === itemTypeId)
  return owned?.quantity ?? 0
}

function affordCost(cost: { coins: number, items: { itemTypeId: string, quantity: number }[] } | null) {
  if (!cost) return false
  if (balance.value < cost.coins) return false
  return cost.items.every(need => ownedQty(need.itemTypeId) >= need.quantity)
}

/** Track flavour — an emoji "building" per track for the blueprint card. */
const TRACK_ART: Record<string, { emoji: string; flavour: string }> = {
  capacity: { emoji: '🏗️', flavour: 'Wider glass, more roommates.' },
  yield_boost: { emoji: '🌾', flavour: 'Richer soil, fatter hauls.' },
  speed_boost: { emoji: '⚡', flavour: 'Snappier legs, shorter cycles.' },
  nutrition_storage: { emoji: '🛢️', flavour: 'A bigger tank between feeds.' },
  nutrition_efficiency: { emoji: '🍃', flavour: 'Every meal goes further.' }
}

function pips(level: number, max: number) {
  const shown = Math.min(max, 20)
  const on = Math.round((Math.min(level, max) / max) * shown)
  return Array.from({ length: shown }, (_, i) => i < on ? 'on' : i === on && level < max ? 'next' : 'off')
}

const startingTrack = ref<string | null>(null)
async function handleStart(track: UpgradeTrack, ev: MouseEvent) {
  if (startingTrack.value) return
  startingTrack.value = track.id
  const el = ev.currentTarget as Element
  try {
    await colony.startUpgrade(track.id)
    sound.play('build-start')
    fx.celebrate(el, { emoji: ['🔨', '🪵', '💨'], count: 8 })
  } catch {
    sound.play('error')
  } finally {
    startingTrack.value = null
  }
}

const collecting = ref<string | null>(null)
async function handleCollect(job: BuilderJob, ev: MouseEvent) {
  if (collecting.value) return
  collecting.value = job.id
  const el = ev.currentTarget as Element
  try {
    await colony.collectUpgrade(job.trackId)
    const isHabitat = job.trackId === HABITAT_BUILDER_JOB_ID
    sound.play(isHabitat ? 'level-up' : 'build-done')
    fx.celebrate(el, { emoji: isHabitat ? ['🎉', '✨', '🏰', '⭐'] : ['✨', '⭐', '🔧'], count: isHabitat ? 22 : 12, text: isHabitat ? 'LEVEL UP!' : `Lv ${job.level}!`, flash: isHabitat, color: '#f5b342' })
    if (isHabitat) {
      nestPop.value = true
      setTimeout(() => { nestPop.value = false }, 800)
    }
  } catch {
    sound.play('error')
  } finally {
    collecting.value = null
  }
}

const nestPop = ref(false)
const expanding = ref(false)
async function handleExpand(ev: MouseEvent) {
  if (expanding.value) return
  expanding.value = true
  const el = ev.currentTarget as Element
  try {
    await colony.upgradeHabitatLevel()
    sound.play('build-start')
    fx.celebrate(el, { emoji: ['🔨', '🏗️', '💨', '🪨'], count: 12 })
  } catch {
    sound.play('error')
  } finally {
    expanding.value = false
  }
}

function onHover() {
  sound.play('hover')
}

const nextTierName = computed(() => TIER_NAMES[habitatLevel.value + 1] ?? '')
</script>

<template>
  <div class="p-3 md:p-5 w-full space-y-4">
    <!-- ── Hero: nest + expansion + crew ───────────────────────────────── -->
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
      <!-- Nest -->
      <div
        class="colony-panel colony-panel-amber p-4 flex flex-col sm:flex-row gap-4 items-center relative overflow-hidden colony-slide-in"
        :class="nestPop ? 'colony-levelup' : ''"
      >
        <div class="colony-shine" />
        <div class="shrink-0 relative">
          <div class="absolute inset-0 rounded-full bg-amber-400/15 blur-2xl" />
          <ColonyNest
            :level="habitatLevel"
            :max-level="maxTier"
            :building="habitatUnderConstruction"
            :size="190"
            class="relative"
          />
        </div>
        <div class="flex-1 min-w-0 w-full">
          <p class="colony-eyebrow">
            The nest
          </p>
          <h1 class="text-2xl colony-title flex items-baseline gap-2">
            Habitat <span class="colony-amber-text text-3xl">Lv {{ habitatLevel }}</span>
            <span class="text-sm text-muted font-bold">/ {{ maxTier }}</span>
          </h1>
          <p class="text-xs text-muted mt-0.5">
            <template v-if="habitatLevel < maxTier">
              Level {{ habitatLevel + 1 }} unlocks <span
                class="font-black"
                :class="tierColor(habitatLevel + 1)"
              >{{ nextTierName }}</span> species in the Market.
            </template>
            <template v-else>
              The nest is fully grown. Every species is unlocked.
            </template>
          </p>

          <template v-if="habitatLevel < maxTier">
            <div class="mt-3 space-y-1">
              <div
                v-for="track in upgrades"
                :key="track.id"
                class="flex items-center justify-between text-xs rounded-lg px-2 py-1 border"
                :class="track.meetsHabitatRequirement ? 'bg-success/10 border-success/25' : 'bg-elevated/60 border-default'"
              >
                <span class="flex items-center gap-1.5 font-bold">
                  <span>{{ TRACK_ART[track.id]?.emoji }}</span>
                  {{ track.name }}
                </span>
                <span
                  class="flex items-center gap-1 font-mono font-black"
                  :class="track.meetsHabitatRequirement ? 'text-success' : 'text-error'"
                >
                  {{ track.level }} / {{ track.requiredLevel }}
                  <UIcon
                    :name="track.meetsHabitatRequirement ? 'i-lucide-check-circle-2' : 'i-lucide-circle-dashed'"
                    class="size-3.5"
                  />
                </span>
              </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-1.5">
              <span
                class="colony-chip"
                :class="balance >= (habitatLevelUpCost ?? 0) ? 'colony-chip-ok' : 'colony-chip-bad'"
              >
                🪙 {{ formatNumber(habitatLevelUpCost ?? 0) }}
              </span>
              <span
                class="colony-chip"
                :class="gems >= (habitatLevelUpGemCost ?? 0) ? 'colony-chip-ok' : 'colony-chip-bad'"
              >
                💎 {{ formatNumber(habitatLevelUpGemCost ?? 0, false) }}
              </span>
              <span class="colony-chip">
                <UIcon
                  name="i-lucide-clock"
                  class="size-3"
                />
                {{ formatDuration(habitatLevelUpDurationMs ?? 0) }}
              </span>
            </div>

            <button
              class="colony-btn colony-btn-block mt-3"
              :class="canStartHabitatLevelUp ? 'colony-btn-pulse' : ''"
              :disabled="!canStartHabitatLevelUp || expanding"
              @click="handleExpand"
              @mouseenter="onHover"
            >
              <UIcon
                name="i-lucide-hammer"
                class="size-4"
              />
              <span v-if="habitatUnderConstruction">Nest expansion underway…</span>
              <span v-else-if="!habitatUpgradeReady">{{ tracksMeetingRequirement }} / {{ upgrades.length }} blueprints ready</span>
              <span v-else-if="buildersFree === 0">{{ builderCount === 1 ? 'Builder busy' : 'All builders busy' }}</span>
              <span v-else-if="!canAffordHabitatLevelUp">Can't afford the expansion yet</span>
              <span v-else>Expand nest to Level {{ habitatLevel + 1 }}</span>
            </button>
          </template>
        </div>
      </div>

      <!-- Crew -->
      <div class="colony-panel p-4 colony-slide-in flex flex-col">
        <div class="flex items-center justify-between mb-3">
          <div>
            <p class="colony-eyebrow">
              Build crew
            </p>
            <h2 class="text-lg colony-title">
              {{ builderCount }} builder{{ builderCount === 1 ? '' : 's' }}
            </h2>
          </div>
          <span
            class="colony-chip"
            :class="buildersFree > 0 ? 'colony-chip-ok' : 'colony-chip-amber'"
          >
            <UIcon
              name="i-lucide-hammer"
              class="size-3"
            />
            {{ builders.length }} busy · {{ buildersFree }} free
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 content-start">
          <div
            v-for="slot in builderSlots"
            :key="slot.key"
            class="colony-card p-3 flex gap-3 items-center"
            :class="slot.job && jobReady(slot.job) ? 'colony-card-max' : ''"
          >
            <ColonyBuilder
              :busy="!!slot.job && !jobReady(slot.job)"
              :ready="!!slot.job && jobReady(slot.job)"
              :size="64"
              class="shrink-0"
            />
            <div class="min-w-0 flex-1">
              <template v-if="slot.job">
                <p class="text-xs font-black truncate">
                  {{ slot.job.trackName }}
                  <span class="text-primary">→ Lv {{ slot.job.level }}</span>
                </p>
                <div class="colony-bar mt-1.5">
                  <div
                    class="colony-bar-fill"
                    :class="jobReady(slot.job) ? 'colony-bar-fill-amber' : ''"
                    :style="{ width: progressPct(slot.job.startedAt, slot.job.completesAt, now) + '%' }"
                  />
                </div>
                <p
                  class="text-[11px] mt-1 font-bold"
                  :class="jobReady(slot.job) ? 'colony-amber-text' : 'text-muted'"
                >
                  {{ jobReady(slot.job) ? 'Done! Tap to collect' : formatDuration(new Date(slot.job.completesAt).getTime() - now) + ' left' }}
                </p>
                <button
                  class="colony-btn colony-btn-sm colony-btn-block mt-2"
                  :class="jobReady(slot.job) ? 'colony-btn-pulse' : 'colony-btn-ghost'"
                  :disabled="!jobReady(slot.job) || collecting === slot.job.id"
                  @click="handleCollect(slot.job, $event)"
                  @mouseenter="onHover"
                >
                  <UIcon
                    :name="jobReady(slot.job) ? 'i-lucide-party-popper' : 'i-lucide-hourglass'"
                    class="size-3.5"
                  />
                  {{ jobReady(slot.job) ? 'Collect' : 'Building…' }}
                </button>
              </template>
              <template v-else>
                <p class="text-xs font-black">
                  Napping
                </p>
                <p class="text-[11px] text-muted mt-0.5">
                  Pick a blueprint below to put this builder to work.
                </p>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Blueprints ──────────────────────────────────────────────────── -->
    <div>
      <div class="flex items-end justify-between mb-2 px-1">
        <div>
          <p class="colony-eyebrow">
            Blueprints
          </p>
          <h2 class="text-lg colony-title">
            Upgrade tracks
          </h2>
        </div>
        <p class="text-xs text-muted hidden sm:block">
          Each build costs coins + foraged items and takes a builder for a while.
        </p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <div
          v-for="(track, idx) in upgrades"
          :key="track.id"
          class="colony-card colony-slide-in"
          :class="[track.atMax ? 'colony-card-max' : '', busyTrackIds.has(track.id) ? 'ring-1 ring-primary/40' : '']"
          :style="{ animationDelay: `${idx * 60}ms` }"
        >
          <span
            v-if="track.atMax"
            class="colony-ribbon"
          >Maxed</span>
          <span
            v-else-if="busyTrackIds.has(track.id)"
            class="colony-ribbon colony-ribbon-busy"
          >Building</span>

          <div class="p-3.5 space-y-3">
            <div class="flex items-center gap-3">
              <div class="relative size-14 shrink-0 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center text-3xl shadow-inner">
                <span :class="busyTrackIds.has(track.id) ? 'colony-wiggle' : ''">{{ TRACK_ART[track.id]?.emoji ?? '🔧' }}</span>
                <span class="absolute -bottom-1.5 -right-1.5 rounded-full bg-primary text-white text-[10px] font-black px-1.5 py-0.5 shadow">Lv {{ track.level }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-black text-sm leading-tight">
                  {{ track.name }}
                </p>
                <p class="text-[11px] text-muted mt-0.5 italic">
                  {{ TRACK_ART[track.id]?.flavour ?? track.description }}
                </p>
                <div class="colony-pips mt-1.5">
                  <span
                    v-for="(p, i) in pips(track.level, track.maxLevel)"
                    :key="i"
                    class="colony-pip"
                    :class="p === 'on' ? (track.atMax ? 'colony-pip-amber' : 'colony-pip-on') : p === 'next' ? 'colony-pip-next' : ''"
                  />
                </div>
              </div>
            </div>

            <div class="rounded-xl bg-black/15 border border-default/60 p-2.5 space-y-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted font-bold">Now</span>
                <span class="font-mono font-black text-highlighted">{{ track.currentEffect }}</span>
              </div>
              <div
                v-if="!track.atMax"
                class="flex items-center justify-between text-xs"
              >
                <span class="text-muted font-bold flex items-center gap-1">
                  <UIcon
                    name="i-lucide-arrow-big-right"
                    class="size-3 text-primary"
                  />
                  Lv {{ track.level + 1 }}
                </span>
                <span class="font-mono font-black text-primary">{{ track.nextEffect }}</span>
              </div>
            </div>
          </div>

          <template v-if="!track.atMax">
            <div class="colony-divider" />
            <div class="p-3.5 space-y-2.5">
              <div class="flex flex-wrap items-center gap-1.5">
                <span
                  class="colony-chip"
                  :class="balance >= (track.nextCost?.coins ?? 0) ? 'colony-chip-ok' : 'colony-chip-bad'"
                >
                  🪙 {{ formatNumber(track.nextCost?.coins ?? 0) }}
                </span>
                <UTooltip
                  v-for="need in track.nextCost?.items ?? []"
                  :key="need.itemTypeId"
                  :delay-duration="150"
                  :content="{ side: 'top', sideOffset: 6 }"
                  :ui="{ content: TOOLTIP_CONTENT_UI }"
                >
                  <template #content>
                    <div class="flex items-center gap-2 mb-1.5">
                      <span class="text-xl leading-none">{{ getItem(need.itemTypeId)?.emoji }}</span>
                      <p class="font-bold text-sm flex items-center gap-1.5">
                        {{ getItem(need.itemTypeId)?.name }}
                        <span
                          class="text-xs font-black"
                          :class="tierColor(getItem(need.itemTypeId)?.tier ?? 1)"
                        >T{{ getItem(need.itemTypeId)?.tier }}</span>
                      </p>
                    </div>
                    <USeparator class="mb-1.5" />
                    <div class="w-full space-y-1 text-xs">
                      <div class="flex justify-between gap-4">
                        <span class="text-muted uppercase tracking-wider font-semibold">Foraged by</span>
                        <span class="font-mono">{{ foragedBy(need.itemTypeId)?.emoji }} {{ foragedBy(need.itemTypeId)?.name ?? '???' }}</span>
                      </div>
                      <div class="flex justify-between gap-4">
                        <span class="text-muted uppercase tracking-wider font-semibold">Have</span>
                        <span class="font-mono">{{ formatNumber(ownedQty(need.itemTypeId), false) }} / {{ formatNumber(need.quantity, false) }}</span>
                      </div>
                      <div class="flex justify-between gap-4">
                        <span class="text-muted uppercase tracking-wider font-semibold">Sells for</span>
                        <CoinBalance
                          class="font-mono"
                          :value="getItem(need.itemTypeId)?.sellValue ?? 0"
                          :compact="false"
                        />
                      </div>
                    </div>
                  </template>
                  <span
                    class="colony-chip cursor-default"
                    :class="ownedQty(need.itemTypeId) >= need.quantity ? 'colony-chip-ok' : 'colony-chip-bad'"
                  >
                    {{ getItem(need.itemTypeId)?.emoji }} {{ formatNumber(ownedQty(need.itemTypeId), false) }}/{{ formatNumber(need.quantity, false) }}
                  </span>
                </UTooltip>
                <span class="colony-chip">
                  <UIcon
                    name="i-lucide-clock"
                    class="size-3"
                  />
                  {{ formatDuration(track.nextDurationMs ?? 0) }}
                </span>
              </div>
              <button
                class="colony-btn colony-btn-block"
                :class="buildBlockedReason(track) ? 'colony-btn-ghost' : 'colony-btn-primary'"
                :disabled="!!buildBlockedReason(track) || startingTrack === track.id"
                @click="handleStart(track, $event)"
                @mouseenter="onHover"
              >
                <UIcon
                  :name="busyTrackIds.has(track.id) ? 'i-lucide-hourglass' : 'i-lucide-hammer'"
                  class="size-4"
                />
                {{ buildBlockedReason(track) ?? `Build Lv ${track.level + 1}` }}
              </button>
            </div>
          </template>
          <div
            v-else
            class="px-3.5 pb-3.5"
          >
            <p class="text-xs colony-amber-text font-black flex items-center gap-1.5">
              <UIcon
                name="i-lucide-crown"
                class="size-4"
              />
              Fully upgraded
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
