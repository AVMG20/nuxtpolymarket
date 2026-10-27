<script setup lang="ts">
import { getItem, BUG_TYPES, TIER_NAMES, bugsByTier } from '#shared/utils/colony'
import { formatDuration, progressPct } from '~/lib/colony-format'

function foragedBy(itemId: string) {
  return BUG_TYPES.find(b => b.itemId === itemId)
}

const colony = useColony()
const { upgrades, builders, builderCount, buildersFree, habitatLevel, maxTier, habitatLevelUpCost, habitatLevelUpDurationMs, habitatLevelUpGemCost } = colony


const now = ref(Date.now())
let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  interval = setInterval(() => {
    now.value = Date.now()
  }, 500)
})
onUnmounted(() => {
  if (interval) clearInterval(interval)
})

// Both derived from the API payload rather than re-declared, so renaming a
// field on the server surfaces here as a type error instead of a blank card.
type BuilderJob = typeof builders.value[number]
type UpgradeTrack = typeof upgrades.value[number]

function jobReady(job: BuilderJob) {
  return now.value >= new Date(job.completesAt).getTime()
}

/** One card per builder — ready ones first, then busy, then an idle card for each free builder. */
const builderSlots = computed<{ key: string, job: BuilderJob | null }[]>(() => [
  ...builders.value.filter(jobReady).map(job => ({ key: job.id, job })),
  ...builders.value.filter(job => !jobReady(job)).map(job => ({ key: job.id, job })),
  ...Array.from({ length: buildersFree.value }, (_, i) => ({ key: `idle-${i}`, job: null }))
])

const collecting = ref<string | null>(null)
async function collect(job: BuilderJob) {
  if (collecting.value) return
  collecting.value = job.id
  try {
    await colony.collectUpgrade(job.trackId)
  } catch {
    // useColony already showed the error
  } finally {
    collecting.value = null
  }
}

// ─── Dig site ───────────────────────────────────────────────────────────────
// Flavour names for the six strata; each Habitat Level digs one layer deeper.
const LAYER_NAMES = ['Topsoil', 'Root Layer', 'Clay Galleries', 'Stone Hollows', 'Ember Vents', 'Royal Chamber']

const strata = computed(() => Array.from({ length: maxTier.value }, (_, i) => {
  const level = i + 1
  return {
    level,
    name: LAYER_NAMES[i] ?? `Layer ${level}`,
    rarity: TIER_NAMES[level] ?? '',
    emojis: bugsByTier(level).map(b => b.emoji).join(''),
    reached: level <= habitatLevel.value,
    here: level === habitatLevel.value,
    next: level === habitatLevel.value + 1
  }
}))

const nextLayer = computed(() => strata.value.find(s => s.next) ?? null)

const { tracksMeetingRequirement, habitatUpgradeReady, habitatBlockedReason, ownedQty } = colony
const { user, balanceNum: balance } = useAuth()
const canAffordCoins = computed(() => balance.value >= habitatLevelUpCost.value)
const canAffordGems = computed(() => (user.value?.gems ?? 0) >= habitatLevelUpGemCost.value)
const canStartHabitatLevelUp = computed(() => habitatBlockedReason.value === null)

const habitatButtonLabel = computed(() => habitatBlockedReason.value ?? `Dig to Level ${habitatLevel.value + 1}`)

const digging = ref(false)
async function startDig() {
  if (!canStartHabitatLevelUp.value || digging.value) return
  digging.value = true
  try {
    await colony.upgradeHabitatLevel()
  } catch {
    // useColony already showed the error
  } finally {
    digging.value = false
  }
}

/** Pip classes for a requirement row: filled to the track's level, the required one outlined in gold. */
function requirementPips(track: UpgradeTrack) {
  const length = Math.max(track.requiredLevel, 1)
  return Array.from({ length }, (_, i) => ({
    on: i < track.level,
    req: i === track.requiredLevel - 1
  }))
}

// ─── Tracks ─────────────────────────────────────────────────────────────────

/** Why a track's Build button is disabled, or null when it can be started. */
const buildBlockedReason = (track: UpgradeTrack) => colony.trackBlockedReason(track)

const startingTrack = ref<string | null>(null)
async function startTrack(track: UpgradeTrack) {
  if (buildBlockedReason(track) || startingTrack.value) return
  startingTrack.value = track.id
  try {
    await colony.startUpgrade(track.id)
  } catch {
    // useColony already showed the error
  } finally {
    startingTrack.value = null
  }
}

function trackPips(track: UpgradeTrack) {
  return Array.from({ length: track.maxLevel }, (_, i) => ({
    on: i < track.level,
    req: habitatLevel.value < maxTier.value && i === track.requiredLevel - 1
  }))
}
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 py-4 md:p-6 space-y-6">
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-5 items-stretch">
      <!-- Dig site depth meter -->
      <section class="cl-panel p-4 flex flex-col gap-2.5">
        <div class="flex items-center justify-between">
          <div>
            <p class="cl-eyebrow">
              Dig site
            </p>
            <h1 class="cl-display text-2xl font-semibold">
              Habitat depth
            </h1>
          </div>
          <span class="cl-lvl w-14 h-[62px] text-[26px]">{{ habitatLevel }}</span>
        </div>
        <ol class="flex flex-col gap-1">
          <li
            v-for="layer in strata"
            :key="layer.level"
            class="relative flex items-center gap-3 px-3 py-2.5 rounded-xl border"
            :class="[
              `cl-t${layer.level}`,
              layer.here ? 'border-yellow-400/60 bg-[color-mix(in_srgb,var(--tc)_10%,transparent)]'
              : layer.reached ? 'border-[#5a4431]/50 bg-[color-mix(in_srgb,var(--tc)_7%,transparent)]'
                : 'border-[#5a4431]/50 bg-[color-mix(in_srgb,var(--tc)_4%,transparent)] opacity-60'
            ]"
          >
            <span class="cl-display cl-num w-6 text-xl font-semibold cl-tc">{{ layer.level }}</span>
            <span class="flex-1 min-w-0">
              <span class="cl-display block font-semibold text-[15px]">{{ layer.name }}</span>
              <span class="text-xs text-muted">
                {{ layer.rarity }}{{ layer.reached ? ' species unlocked' : ' · locked' }}<template v-if="layer.here">
                  · <span class="font-semibold text-amber-400">You are here</span>
                </template>
              </span>
            </span>
            <span
              class="text-[22px] tracking-wider"
              :class="!layer.reached && 'cl-silhouette'"
              aria-hidden="true"
            >{{ layer.emojis }}</span>
          </li>
        </ol>
      </section>

      <!-- Next dig -->
      <section
        v-if="habitatLevel < maxTier"
        class="cl-panel p-4 sm:p-[18px] flex flex-col gap-3.5"
      >
        <div class="flex items-center gap-3.5 flex-wrap">
          <span class="cl-lvl cl-lvl-dark w-16 h-[72px] text-3xl">{{ habitatLevel + 1 }}</span>
          <div class="flex-[1_1_220px] min-w-0">
            <p class="cl-eyebrow">
              Next dig
            </p>
            <h2 class="cl-display text-xl sm:text-[26px] font-semibold leading-tight">
              Habitat Level {{ habitatLevel + 1 }} · {{ nextLayer?.name }}
            </h2>
            <p class="text-[13px] text-muted">
              Unlocks {{ TIER_NAMES[habitatLevel + 1] }} species <span class="text-base">{{ nextLayer?.emojis }}</span>
            </p>
          </div>
          <div class="text-right">
            <p
              class="cl-display cl-num text-3xl font-semibold"
              :class="habitatUpgradeReady ? 'text-green-400' : 'text-amber-400'"
            >
              {{ tracksMeetingRequirement }} / {{ upgrades.length }}
            </p>
            <p class="text-xs font-semibold text-muted">
              tracks ready
            </p>
          </div>
        </div>

        <div class="grid gap-2">
          <div
            v-for="track in upgrades"
            :key="track.id"
            class="cl-inset grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[200px_minmax(0,1fr)_96px] gap-x-3.5 gap-y-2 items-center px-3 py-2.5"
          >
            <span class="flex items-center gap-2 font-semibold min-w-0">
              <UIcon
                :name="track.icon"
                class="size-4 shrink-0 text-amber-300"
              />
              <span class="truncate">{{ track.name }}</span>
            </span>
            <span
              class="cl-num text-right font-semibold sm:order-last"
              :class="track.meetsHabitatRequirement ? 'text-green-400' : 'text-red-300'"
            >
              Lv {{ track.level }} / {{ track.requiredLevel }}
              <UIcon
                v-if="track.meetsHabitatRequirement"
                name="i-lucide-check"
                class="size-3.5 align-[-2px]"
              />
            </span>
            <span class="cl-seg-pips col-span-2 sm:col-span-1">
              <span
                v-for="(pip, i) in requirementPips(track)"
                :key="i"
                class="cl-seg-pip"
                :class="[pip.on && 'cl-seg-pip-on', pip.req && 'cl-seg-pip-req']"
              />
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2.5 flex-wrap">
          <span
            class="cl-cost"
            :class="canAffordCoins ? 'cl-cost-ok' : 'cl-cost-short'"
          >
            <ColonyCurrencyIcon :size="14" />
            {{ formatNumber(habitatLevelUpCost ?? 0) }}
          </span>
          <span
            class="cl-cost"
            :class="canAffordGems ? 'cl-cost-ok' : 'cl-cost-short'"
          >
            <ColonyCurrencyIcon
              kind="gem"
              :size="14"
            />
            {{ formatNumber(habitatLevelUpGemCost ?? 0) }}
          </span>
          <span class="cl-cost cl-cost-ok">
            <UIcon
              name="i-lucide-clock"
              class="size-3.5"
            />
            {{ formatDuration(habitatLevelUpDurationMs ?? 0) }}
          </span>
          <span class="flex-1" />
          <button
            type="button"
            class="cl-btn cl-btn-gold w-full sm:w-auto"
            :class="canStartHabitatLevelUp && 'cl-btn-pulse'"
            :disabled="!canStartHabitatLevelUp || digging"
            @click="startDig"
          >
            <UIcon
              :name="digging ? 'i-lucide-loader-circle' : 'i-lucide-shovel'"
              class="size-4"
              :class="digging && 'animate-spin'"
            />
            {{ habitatButtonLabel }}
          </button>
        </div>
      </section>
      <section
        v-else
        class="cl-panel p-6 flex flex-col items-center justify-center gap-2 text-center"
      >
        <span class="text-5xl">👑</span>
        <h2 class="cl-display text-2xl font-semibold text-amber-200">
          The Royal Chamber
        </h2>
        <p class="text-sm text-muted max-w-sm">
          Your burrow is as deep as it goes. Keep the tracks climbing to grow the colony further.
        </p>
      </section>
    </div>

    <!-- Builders -->
    <section>
      <div class="flex items-baseline gap-2.5 mb-2.5 flex-wrap">
        <h2 class="cl-display text-[22px] font-semibold">
          Builders
        </h2>
        <span class="text-[13px] text-muted">
          {{ builderCount }} {{ builderCount === 1 ? 'worker' : 'workers' }} · the Labour Contract in the Prestige Shop hires more
        </span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
        <template
          v-for="slot in builderSlots"
          :key="slot.key"
        >
          <div
            v-if="slot.job && jobReady(slot.job)"
            class="cl-panel cl-ready-glow px-4 py-3.5 flex gap-3.5 items-center"
          >
            <span class="inline-block text-[32px]">🐜</span>
            <div class="flex-1 min-w-0">
              <p class="cl-display text-[17px] font-semibold text-green-300">
                {{ slot.job.trackName }} → Lv {{ slot.job.level }} is done!
              </p>
              <div class="cl-bar mt-2">
                <div
                  class="cl-bar-fill"
                  style="width: 100%"
                />
              </div>
            </div>
            <button
              type="button"
              class="cl-btn cl-btn-green cl-btn-pulse"
              :disabled="collecting === slot.job.id"
              @click="collect(slot.job)"
            >
              Collect
            </button>
          </div>
          <div
            v-else-if="slot.job"
            class="cl-panel px-4 py-3.5 flex gap-3.5 items-center"
          >
            <span class="text-[32px]">⛏️</span>
            <div class="flex-1 min-w-0">
              <p class="cl-display text-[17px] font-semibold truncate">
                Digging {{ slot.job.trackName }} → Lv {{ slot.job.level }}
              </p>
              <div class="cl-bar cl-bar-stripes mt-2">
                <div
                  class="cl-bar-fill cl-bar-fill-gold"
                  :style="{ width: progressPct(slot.job.startedAt, slot.job.completesAt, now) + '%' }"
                />
              </div>
              <div class="cl-num flex justify-between text-[12.5px] mt-1.5">
                <span class="text-muted">{{ Math.floor(progressPct(slot.job.startedAt, slot.job.completesAt, now)) }}%</span>
                <span class="font-semibold">{{ formatDuration(new Date(slot.job.completesAt).getTime() - now) }} left</span>
              </div>
            </div>
          </div>
          <div
            v-else
            class="cl-panel border-dashed px-4 py-3.5 flex gap-3.5 items-center"
          >
            <span class="text-[40px] opacity-55">🐜</span>
            <div class="flex-1 min-w-0">
              <p class="cl-display text-[17px] font-semibold">
                Idle builder
              </p>
              <p class="text-[12.5px] text-muted">
                Pick a track below to start digging.
              </p>
            </div>
            <span class="cl-chip">Zzz</span>
          </div>
        </template>
      </div>
    </section>

    <!-- Tracks -->
    <section>
      <h2 class="cl-display text-[22px] font-semibold mb-2.5">
        Upgrade tracks
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        <article
          v-for="track in upgrades"
          :key="track.id"
          class="cl-panel p-4 flex flex-col gap-3"
        >
          <div class="flex items-center gap-3">
            <span class="size-12 rounded-[14px] grid place-items-center bg-black/40 border border-[#5a4431] shrink-0">
              <UIcon
                :name="track.icon"
                class="size-6 text-amber-300"
              />
            </span>
            <div class="flex-1 min-w-0">
              <h3 class="cl-display text-lg font-semibold">
                {{ track.name }}
              </h3>
              <p class="text-[12.5px] text-muted">
                {{ track.description }}
              </p>
            </div>
            <span class="cl-lvl w-[42px] h-12 text-[19px]">{{ track.level }}</span>
          </div>

          <div>
            <span class="cl-seg-pips">
              <span
                v-for="(pip, i) in trackPips(track)"
                :key="i"
                class="cl-seg-pip"
                :class="[pip.on && 'cl-seg-pip-on', pip.req && 'cl-seg-pip-req']"
              />
            </span>
            <div class="cl-num flex justify-between gap-2 text-xs font-semibold mt-1.5">
              <span class="text-muted">Lv {{ track.level }} / {{ track.maxLevel }}</span>
              <span
                v-if="habitatLevel < maxTier"
                :class="track.meetsHabitatRequirement ? 'text-green-400' : 'text-amber-400'"
              >
                Habitat {{ habitatLevel + 1 }} needs Lv {{ track.requiredLevel }}{{ track.meetsHabitatRequirement ? ' ✓' : '' }}
              </span>
            </div>
          </div>

          <div class="cl-inset flex items-center justify-between gap-2 px-3 py-2.5">
            <span class="cl-display cl-num text-[15px] sm:text-[17px] font-semibold">{{ track.currentEffect }}</span>
            <template v-if="!track.atMax">
              <UIcon
                name="i-lucide-arrow-right"
                class="size-5 text-green-400 shrink-0"
              />
              <span class="cl-display cl-num text-[15px] sm:text-[17px] font-semibold text-green-400 text-right">{{ track.nextEffect }}</span>
            </template>
          </div>

          <template v-if="!track.atMax">
            <div class="flex gap-1.5 flex-wrap">
              <span
                class="cl-cost"
                :class="balance >= (track.nextCost?.coins ?? 0) ? 'cl-cost-ok' : 'cl-cost-short'"
              >
                <ColonyCurrencyIcon :size="14" />
                {{ formatNumber(track.nextCost?.coins ?? 0) }}
              </span>
              <UTooltip
                v-for="need in track.nextCost?.items ?? []"
                :key="need.itemTypeId"
                :delay-duration="150"
                :content="{ side: 'top', sideOffset: 6 }"
                :ui="{ content: 'cl-theme cl-tooltip h-auto max-w-64 p-3 flex-col items-start rounded-xl z-50' }"
              >
                <template #content>
                  <p class="cl-display font-semibold text-sm mb-1.5">
                    {{ getItem(need.itemTypeId)?.emoji }} {{ getItem(need.itemTypeId)?.name }}
                    <span
                      class="cl-tc"
                      :class="`cl-t${getItem(need.itemTypeId)?.tier ?? 1}`"
                    >T{{ getItem(need.itemTypeId)?.tier }}</span>
                  </p>
                  <dl class="w-full space-y-1 text-xs">
                    <div class="flex justify-between gap-4">
                      <dt class="text-muted">
                        Foraged by
                      </dt>
                      <dd class="font-semibold">
                        {{ foragedBy(need.itemTypeId)?.emoji }} {{ foragedBy(need.itemTypeId)?.name ?? '???' }}
                      </dd>
                    </div>
                    <div class="flex justify-between gap-4">
                      <dt class="text-muted">
                        Have
                      </dt>
                      <dd class="cl-num font-semibold">
                        {{ formatNumber(ownedQty(need.itemTypeId), false) }} / {{ formatNumber(need.quantity, false) }}
                      </dd>
                    </div>
                    <div class="flex justify-between gap-4">
                      <dt class="text-muted">
                        Sells for
                      </dt>
                      <dd class="cl-num font-semibold">
                        {{ formatNumber(getItem(need.itemTypeId)?.sellValue ?? 0, false) }}
                      </dd>
                    </div>
                  </dl>
                </template>
                <span
                  class="cl-cost cursor-default"
                  :class="ownedQty(need.itemTypeId) >= need.quantity ? 'cl-cost-met' : 'cl-cost-short'"
                >
                  {{ getItem(need.itemTypeId)?.emoji }} {{ formatNumber(ownedQty(need.itemTypeId)) }}/{{ formatNumber(need.quantity) }}
                </span>
              </UTooltip>
            </div>
            <button
              type="button"
              class="cl-btn w-full mt-auto"
              :class="buildBlockedReason(track) ? 'cl-btn-ghost' : 'cl-btn-green'"
              :disabled="!!buildBlockedReason(track) || startingTrack === track.id"
              @click="startTrack(track)"
            >
              <span class="truncate">{{ buildBlockedReason(track) ?? `Build Lv ${track.level + 1} · ${formatDuration(track.nextDurationMs ?? 0)}` }}</span>
            </button>
          </template>
          <p
            v-else
            class="cl-chip cl-chip-green self-start mt-auto"
          >
            <UIcon
              name="i-lucide-check"
              class="size-3.5"
            />
            Maxed out
          </p>
        </article>
      </div>
    </section>
  </div>
</template>
