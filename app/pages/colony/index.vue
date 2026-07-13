<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { tierBg, tierColor, levelTextColor } from '#shared/utils/xeno'
import { avgTickYield } from '#shared/utils/colony'
import { formatDuration, traitTextColor } from '~/utils/colony-format'

const colony = useColony()
const { bugs, bugInventory, inventory, capacity, placedCount, nutrition, nutritionMax, nutritionDrainPerHour, feedCost, gemNutrition, gemBuffActive, gemFeedCost, initialized, pending, pendingLoot, serverNow } = colony

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

const sidebarTab = ref<'inventory' | 'bugs' | 'resources'>('inventory')
const sidebarTabItems = [
  { label: 'Inventory', value: 'inventory', icon: 'i-lucide-package' },
  { label: 'Bugs', value: 'bugs', icon: 'i-lucide-bug' },
  { label: 'Resources', value: 'resources', icon: 'i-lucide-box' }
]

const resourcesOwned = computed(() => [...inventory.value].sort((a: any, b: any) => a.tier - b.tier || a.name.localeCompare(b.name)))

/** Effective tick time for an unplaced stack (speed trait applied, no habitat speed_boost track since that's colony-wide and not modeled here for a dormant bug — matches the market card's own convention). */
function stackTickMs(stack: any): number {
  return stack.baseTickMs * (1 - stack.speed / 100)
}

/** Items/hr for an unplaced stack — no social bonus yet since it isn't placed. Uses the expected per-tick roll (see avgTickYield), not the raw yield level. */
function stackItemsPerHour(stack: any): number {
  const tickMs = stackTickMs(stack)
  return tickMs > 0 ? (avgTickYield(stack.yield) / tickMs) * 3_600_000 : 0
}

function stackCoinsPerHour(stack: any): number {
  return stackItemsPerHour(stack) * (stack.itemSellValue ?? 0)
}

/** Per-cycle output range for an unplaced (dormant) stack — no social bonus yet, so just the raw 1..yield+1 roll range. */
function stackYieldPerCycle(stack: any): string {
  return `1–${stack.yield + 1}`
}

// UTooltip's default content class is a fixed-height (h-6), single-line badge
// meant for short text/kbd hints — it clips rich multi-line #content slots
// (like the ones below) to that 24px height, so the popup's background/ring
// only covers the first sliver and the rest of the text renders with no
// backing panel at all. Override just enough to let it size to content.
const TOOLTIP_CONTENT_UI = 'h-auto max-w-72 p-3 flex-col items-start bg-default ring ring-default rounded-lg shadow-lg z-50'

const placingKey = ref<string | null>(null)
const unplacingId = ref<string | null>(null)

function stackKey(stack: any) {
  return `${stack.typeId}:${stack.speed}:${stack.yield}:${stack.eat}`
}

// ─── Inventory sort/filter (Inventory tab) ─────────────────────────────────
const inventorySortOptions = [
  { label: 'Tier', value: 'tier' },
  { label: 'Name', value: 'name' },
  { label: 'Speed', value: 'speed' },
  { label: 'Yield', value: 'yield' },
  { label: 'Quantity', value: 'quantity' }
]
const inventorySortBy = ref<'tier' | 'name' | 'speed' | 'yield' | 'quantity'>('tier')
const inventoryDirOptions = [
  { label: 'Highest first', value: 'desc' },
  { label: 'Lowest first', value: 'asc' }
]
const inventorySortDir = ref<'desc' | 'asc'>('desc')
const inventoryFilterType = ref('all')

const inventoryFilterOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const stack of bugInventory.value) {
    if (!seen.has(stack.typeId)) seen.set(stack.typeId, stack.name)
  }
  return [
    { label: 'All types', value: 'all' },
    ...Array.from(seen, ([value, label]) => ({ label, value }))
  ]
})

const filteredSortedBugInventory = computed(() => {
  const dir = inventorySortDir.value === 'asc' ? 1 : -1
  return [...bugInventory.value]
    .filter(stack => inventoryFilterType.value === 'all' || stack.typeId === inventoryFilterType.value)
    .sort((a, b) => {
      let cmp = 0
      if (inventorySortBy.value === 'tier') cmp = a.tier - b.tier
      else if (inventorySortBy.value === 'name') cmp = a.name.localeCompare(b.name)
      else if (inventorySortBy.value === 'speed') cmp = a.speed - b.speed
      else if (inventorySortBy.value === 'yield') cmp = a.yield - b.yield
      else cmp = a.quantity - b.quantity
      if (cmp === 0) cmp = a.name.localeCompare(b.name)
      return cmp * dir
    })
})

async function handlePlace(stack: any) {
  if (placingKey.value || placedCount.value >= capacity.value) return
  placingKey.value = stackKey(stack)
  try {
    await colony.placeBug(stack.typeId, stack.speed, stack.yield, stack.eat)
  } finally {
    placingKey.value = null
  }
}

async function handleUnplace(bugId: string) {
  if (unplacingId.value) return
  unplacingId.value = bugId
  try {
    await colony.unplaceBug(bugId)
  } finally {
    unplacingId.value = null
  }
}

// ─── Nutrition / feeding ────────────────────────────────────────────────────
// `nutrition` is only as fresh as the last server round-trip (a fetch, or
// any action that triggers one) — displaying it raw makes the bar look like
// it only drops when the player happens to do something (like opening the
// loot chest), when really it's been draining continuously the whole time.
// liveNutrition interpolates from that last-known value using the same
// nowTick clock the bug progress bars use, anchored to the server's own
// clock (serverNow) rather than local time so latency doesn't skew it.

const isStarving = computed(() => liveTotalNutrition.value <= 0)
const nutritionLow = computed(() => liveTotalNutrition.value > 0 && liveTotalNutrition.value / nutritionMax.value < 0.25)
const nutritionEtaMs = computed(() => nutritionDrainPerHour.value > 0 ? (liveTotalNutrition.value / nutritionDrainPerHour.value) * 3_600_000 : null)
const nutritionEtaClock = computed(() => {
  if (nutritionEtaMs.value === null) return null
  return new Date(Date.now() + nutritionEtaMs.value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
})

const feeding = ref(false)
const canFeed = computed(() => feedCost.value > 0 && balance.value >= feedCost.value)
const canGemFeed = computed(() => gemFeedCost.value > 0 && gems.value >= gemFeedCost.value)

async function handleFeed() {
  if (feeding.value || !canFeed.value) return
  feeding.value = true
  try {
    await colony.feedSwarm('coins')
  } finally {
    feeding.value = false
  }
}

async function handleGemFeed() {
  if (feeding.value || !canGemFeed.value) return
  feeding.value = true
  try {
    await colony.feedSwarm('gems')
  } finally {
    feeding.value = false
  }
}

// light poll so nutrition/loot stay fresh without a heavy server loop —
// production itself is always settled analytically on the server when this fires
let pollHandle: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollHandle = setInterval(() => colony.refresh(), 30_000)
})
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle)
})

// ─── Loot chest ─────────────────────────────────────────────────────────────

interface FloatText { id: number, text: string, x: number, y: number }
let floatSeq = 0
const chestFloats = ref<FloatText[]>([])
const chestBusy = ref(false)

async function handleCollect() {
  if (chestBusy.value) return
  chestBusy.value = true
  try {
    const res = await colony.collectLoot()
    const collected = res?.collected ?? []
    // stagger each popup's appearance so they don't all stack on top of
    // each other — pushed one at a time instead of all at once
    collected.forEach((item: any, i: number) => {
      setTimeout(() => {
        const id = floatSeq++
        const x = 50 + (Math.random() - 0.5) * 70
        chestFloats.value.push({ id, text: `+${formatNumber(item.quantity, false)} ${item.emoji}`, x, y: 0 })
        setTimeout(() => {
          chestFloats.value = chestFloats.value.filter(f => f.id !== id)
        }, 1600)
      }, i * 220)
    })
  } finally {
    chestBusy.value = false
  }
}

async function handleInit() {
  await colony.initColony()
}

// ─── Bug list progress bars ─────────────────────────────────────────────────
// bugsSyncedAt marks the moment `bugs` last changed (matches the timestamp the
// terrarium canvas uses internally) so these bars can interpolate between polls
// without needing access to the canvas component's own animation state.

const nowTick = ref(Date.now())
let progressInterval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  progressInterval = setInterval(() => {
    nowTick.value = Date.now()
  }, 500)
})
onUnmounted(() => {
  if (progressInterval) clearInterval(progressInterval)
})

/**
 * Nutrition, interpolated smoothly between polls instead of only jumping on
 * the next server round-trip. Gem-fed nutrition always drains first (see
 * settleColony) — nutritionDrainPerHour already reflects whichever rate is
 * CURRENTLY active, so the combined drain is split gem-pool-first here too,
 * self-correcting at the next real poll regardless of small approximation
 * error right around the moment the gem pool actually runs dry.
 */
const liveGemNutrition = computed(() => {
  const elapsedMs = Math.max(0, nowTick.value - serverNow.value)
  const drainPerMs = nutritionDrainPerHour.value / 3_600_000
  return Math.max(0, gemNutrition.value - drainPerMs * elapsedMs)
})
const liveNutrition = computed(() => {
  const elapsedMs = Math.max(0, nowTick.value - serverNow.value)
  const drainPerMs = nutritionDrainPerHour.value / 3_600_000
  const totalDrained = drainPerMs * elapsedMs
  const spillover = Math.max(0, totalDrained - gemNutrition.value)
  return Math.max(0, Math.min(nutritionMax.value, nutrition.value - spillover))
})
const liveTotalNutrition = computed(() => liveGemNutrition.value + liveNutrition.value)

const bugsSyncedAt = ref(Date.now())
watch(() => bugs.value.map((b: any) => `${b.id}:${b.tickProgressMs}`).join(','), () => {
  bugsSyncedAt.value = Date.now()
})

function bugProgressPct(bug: any) {
  if (isStarving.value) return Math.min(100, (bug.tickProgressMs / bug.tickMs) * 100)
  const elapsed = Math.max(0, nowTick.value - bugsSyncedAt.value)
  const total = bug.tickProgressMs + elapsed
  return Math.min(100, ((total % bug.tickMs) / bug.tickMs) * 100)
}

function bugCountdown(bug: any) {
  if (isStarving.value) return 'Starving'
  const elapsed = Math.max(0, nowTick.value - bugsSyncedAt.value)
  const total = bug.tickProgressMs + elapsed
  const remaining = bug.tickMs - (total % bug.tickMs)
  const secs = Math.max(0, Math.ceil(remaining / 1000))
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${secs}s`
}

/**
 * How much this bug actually drops per cycle — not a per-hour rate. Every
 * completed cycle rolls 1 + random(0..bug.yield) items, so output genuinely
 * varies tick to tick; shown as the real [itemsPerTickMin, itemsPerTickMax]
 * range (after social + habitat multipliers), not a single number.
 */
function bugYieldPerCycle(bug: any): string {
  const min = Math.round(bug.itemsPerTickMin ?? 1)
  const max = Math.round(bug.itemsPerTickMax ?? bug.yield + 1)
  return max > min ? `${min}–${max}` : `${min}`
}
</script>

<template>
  <div class="p-4 md:p-6 w-full">
    <div
      v-if="!pending && !initialized"
      class="flex flex-col items-center justify-center py-24 gap-4 text-center"
    >
      <UIcon
        name="i-lucide-bug"
        class="size-12 text-primary"
      />
      <div>
        <h1 class="text-xl font-bold">
          Found your colony
        </h1>
        <p class="text-sm text-muted max-w-sm">
          COLONY is an idle bug empire for established players — species start at {{ formatNumber(120000) }} coins and pay for themselves over days of foraging. Found the colony, buy your first bugs in the Market, and keep them fed.
        </p>
      </div>
      <UButton
        size="lg"
        icon="i-lucide-sprout"
        @click="handleInit"
      >
        Found Colony
      </UButton>
    </div>

    <template v-else>
      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_26rem] gap-6 max-w-full overflow-x-hidden">
        <!-- Nutrition + Terrarium + chest -->
        <div class="space-y-3 flex flex-col items-center">
          <!-- Nutrition bar -->
          <UCard class="w-full">
            <div class="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
              <span class="text-sm font-medium text-muted flex items-center gap-1.5">
                <UIcon
                  name="i-lucide-heart-pulse"
                  class="size-4"
                />
                Colony Nutrition
                <span class="font-mono text-xs">{{ formatNumber(Math.round(liveTotalNutrition), false) }} / {{ formatNumber(nutritionMax, false) }}</span>
                <span
                  v-if="gemBuffActive"
                  class="inline-flex items-center gap-1 text-[10px] font-bold text-info bg-info/10 border border-info/30 rounded-full px-1.5 py-0.5"
                  title="Gem-fed nutrition is active: +1 yield and +20% speed, colony-wide, until it runs out."
                >
                  💎 Buffed
                </span>
              </span>
              <div class="flex items-center gap-1.5">
                <UButton
                  size="xs"
                  color="info"
                  variant="soft"
                  icon="i-lucide-gem"
                  :loading="feeding"
                  :disabled="!canGemFeed"
                  title="Top up with gems — expensive, but grants +1 yield and +20% speed colony-wide while it lasts."
                  @click="handleGemFeed"
                >
                  {{ gemFeedCost <= 0 ? 'Full' : `${formatNumber(gemFeedCost, false)} 💎` }}
                </UButton>
                <UButton
                  size="xs"
                  :color="isStarving ? 'error' : nutritionLow ? 'warning' : 'primary'"
                  :variant="isStarving || nutritionLow ? 'solid' : 'soft'"
                  icon="i-lucide-utensils"
                  :loading="feeding"
                  :disabled="!canFeed"
                  @click="handleFeed"
                >
                  {{ feedCost <= 0 ? 'Full' : `Feed — ${formatNumber(feedCost, false)} coins` }}
                </UButton>
              </div>
            </div>
            <div class="h-1.5 rounded-full bg-elevated overflow-hidden flex">
              <div
                class="h-full transition-all"
                :class="isStarving ? 'bg-error' : nutritionLow ? 'bg-warning' : 'bg-primary'"
                :style="{ width: (liveNutrition / nutritionMax) * 100 + '%' }"
              />
              <div
                class="h-full bg-info transition-all"
                :style="{ width: (liveGemNutrition / nutritionMax) * 100 + '%' }"
              />
            </div>
            <p
              v-if="isStarving"
              class="text-xs text-error font-medium mt-1.5 flex items-center gap-1"
            >
              <UIcon name="i-lucide-alert-triangle" />
              Colony is starving — all foraging has stopped until you feed.
            </p>
            <p
              v-else
              class="text-xs mt-1.5 flex items-center gap-1"
              :class="nutritionLow ? 'text-warning' : 'text-muted'"
            >
              <UIcon
                name="i-lucide-clock"
                class="size-3"
              />
              <template v-if="nutritionEtaMs !== null">
                Runs out in {{ formatDuration(nutritionEtaMs) }} (around {{ nutritionEtaClock }}) — bugs stop foraging at zero.
              </template>
              <template v-else>
                Not draining — no bugs eating right now.
              </template>
            </p>
          </UCard>

          <ColonyTerrariumCanvas
            :bugs="bugs"
            :is-starving="isStarving"
            :has-spare-bugs="!!bugInventory.length"
          />

          <div class="relative flex flex-col items-center gap-2 pt-2">
            <UButton
              size="xl"
              color="warning"
              variant="soft"
              icon="i-lucide-package-open"
              :loading="chestBusy"
              :disabled="!pendingLoot.length"
              @click="handleCollect"
            >
              Open loot chest
            </UButton>
            <div
              v-for="f in chestFloats"
              :key="f.id"
              class="colony-chest-float pointer-events-none absolute text-sm font-semibold whitespace-nowrap"
              :style="{ left: 'calc(50% + ' + (f.x - 50) + 'px)', bottom: '100%' }"
            >
              {{ f.text }}
            </div>
            <div
              v-if="pendingLoot.length"
              class="flex flex-wrap justify-center gap-1.5 max-w-md"
            >
              <UBadge
                v-for="item in pendingLoot"
                :key="item.itemTypeId"
                color="warning"
                variant="subtle"
                size="sm"
              >
                {{ item.emoji }} {{ formatNumber(item.quantity, false) }}
              </UBadge>
            </div>
            <p
              v-else
              class="text-xs text-muted"
            >
              Nothing waiting yet — bugs forage on their own, check back soon.
            </p>
          </div>
        </div>

        <!-- Right sidebar: xeno-style inventory / bugs panel, fills full column height -->
        <div class="rounded-xl border border-default bg-elevated/30 overflow-hidden flex flex-col">
          <div class="flex items-center justify-between px-3 py-2.5 border-b border-default">
            <span class="text-xs font-semibold uppercase tracking-wider text-muted">Terrarium</span>
            <span
              class="text-xs font-mono"
              :class="placedCount >= capacity ? 'text-warning' : 'text-muted'"
            >{{ placedCount }} / {{ capacity }}</span>
          </div>

          <div class="px-2 pt-2 border-b border-default">
            <UTabs
              v-model="sidebarTab"
              :items="sidebarTabItems"
              size="xs"
              class="w-full"
            />
          </div>

          <!-- Inventory tab -->
          <template v-if="sidebarTab === 'inventory'">
            <div
              v-if="bugInventory.length"
              class="flex items-center gap-1 px-2 py-1.5 border-b border-default"
            >
              <USelect
                v-model="inventorySortBy"
                :items="inventorySortOptions"
                size="xs"
                class="flex-1 min-w-0"
              />
              <USelect
                v-model="inventorySortDir"
                :items="inventoryDirOptions"
                size="xs"
                class="flex-1 min-w-0"
              />
              <USelect
                v-model="inventoryFilterType"
                :items="inventoryFilterOptions"
                size="xs"
                class="flex-1 min-w-0"
              />
            </div>

            <div
              v-if="!bugInventory.length"
              class="py-10 text-center px-4"
            >
              <UIcon
                name="i-lucide-package"
                class="size-8 text-muted/30 mx-auto mb-2"
              />
              <p class="text-sm text-muted">
                No spare bugs.
              </p>
              <p class="text-xs text-muted/50 mt-1">
                Buy more in the <NuxtLink
                  to="/colony/market"
                  class="text-primary underline"
                >Market</NuxtLink>.
              </p>
            </div>

            <div
              v-else-if="!filteredSortedBugInventory.length"
              class="py-10 text-center px-4"
            >
              <UIcon
                name="i-lucide-filter-x"
                class="size-8 text-muted/30 mx-auto mb-2"
              />
              <p class="text-sm text-muted">
                No bugs match this filter.
              </p>
            </div>

            <div
              v-else
              class="p-2 grid grid-cols-3 gap-1.5 flex-1 overflow-y-auto content-start"
            >
              <UTooltip
                v-for="stack in filteredSortedBugInventory"
                :key="stackKey(stack)"
                :delay-duration="300"
                :content="{ side: 'left', sideOffset: 8 }"
                :ui="{ content: TOOLTIP_CONTENT_UI }"
              >
                <template #content>
                  <div class="w-56 space-y-3">
                    <div class="flex items-start justify-between gap-2">
                      <p class="font-bold text-sm flex items-center gap-1.5">
                        {{ stack.emoji }} {{ stack.name }}
                      </p>
                      <span
                        class="text-xs font-black rounded-full border px-2 py-0.5 shrink-0"
                        :class="[tierColor(stack.tier), tierBg(stack.tier)]"
                      >T{{ stack.tier }}</span>
                    </div>

                    <USeparator />
                    <div class="space-y-1.5">
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-xs font-bold uppercase tracking-wider text-muted">Speed</span>
                        <span
                          class="text-xs font-black tabular-nums"
                          :class="traitTextColor(stack.speed)"
                        >{{ stack.speed }}%</span>
                      </div>
                      <XenoStatLevel
                        label="Yield"
                        :level="stack.yield"
                        :max="8"
                        color="bg-info"
                      />
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-xs font-bold uppercase tracking-wider text-muted">Eat</span>
                        <span class="text-xs font-black tabular-nums text-muted">{{ stack.eat }} / cycle</span>
                      </div>
                    </div>

                    <USeparator />
                    <div class="space-y-1">
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Owned</span>
                        <span class="font-mono">×{{ stack.quantity }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Cycle</span>
                        <span class="font-mono">{{ formatDuration(stackTickMs(stack)) }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Per cycle</span>
                        <span class="font-mono">{{ stack.itemEmoji }} {{ stackYieldPerCycle(stack) }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Per hour</span>
                        <span class="font-mono">{{ stack.itemEmoji }} {{ formatNumber(Math.round(stackItemsPerHour(stack)), false) }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Coins/hr</span>
                        <CoinBalance
                          :show-icon="false"
                          :value="stackCoinsPerHour(stack)"
                          :compact="false"
                        />
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Eats</span>
                        <span class="font-mono">{{ formatNumber(Math.round(stack.feedPerHour), false) }}/hr</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Temperament</span>
                        <span class="font-mono flex items-center gap-1">
                          <UIcon
                            :name="stack.social ? 'i-lucide-users' : 'i-lucide-user'"
                            class="size-3"
                          />
                          {{ stack.social ? 'Social' : 'Solitary' }}
                        </span>
                      </div>
                    </div>
                  </div>
                </template>

                <button
                  class="relative flex flex-col rounded-xl border aspect-square w-full overflow-hidden transition-all duration-100 disabled:opacity-50"
                  :class="[tierBg(stack.tier), placingKey === stackKey(stack) ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/50']"
                  :disabled="placedCount >= capacity || !!placingKey"
                  @click="handlePlace(stack)"
                >
                  <div class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-0">
                    <span class="text-3xl leading-none">{{ stack.emoji }}</span>
                  </div>
                  <p class="text-xs font-bold text-center px-1 mb-1 truncate shrink-0">
                    {{ stack.name }}
                  </p>
                  <div class="flex divide-x divide-default border-t border-default shrink-0">
                    <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
                      <UIcon
                        name="i-lucide-zap"
                        class="size-2.5 shrink-0"
                        :class="traitTextColor(stack.speed)"
                      />
                      <span
                        class="text-[10px] font-black tabular-nums"
                        :class="traitTextColor(stack.speed)"
                      >{{ stack.speed }}%</span>
                    </div>
                    <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
                      <UIcon
                        name="i-lucide-gem"
                        class="size-2.5 shrink-0"
                        :class="levelTextColor(stack.yield)"
                      />
                      <span
                        class="text-[10px] font-black tabular-nums"
                        :class="levelTextColor(stack.yield)"
                      >{{ stack.yield }}</span>
                    </div>
                    <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
                      <UIcon
                        name="i-lucide-utensils"
                        class="size-2.5 shrink-0 text-muted"
                      />
                      <span class="text-[10px] font-black tabular-nums text-muted">{{ stack.eat }}</span>
                    </div>
                  </div>
                </button>
              </UTooltip>
            </div>

            <p
              v-if="bugInventory.length && placedCount >= capacity"
              class="text-xs text-warning text-center px-3 py-2 border-t border-default"
            >
              Terrarium full — upgrade Capacity in the Habitat.
            </p>
          </template>

          <!-- Bugs tab: everything currently placed in the terrarium -->
          <template v-if="sidebarTab === 'bugs'">
            <div
              v-if="bugs.length"
              class="p-2 grid grid-cols-3 gap-1.5 flex-1 overflow-y-auto content-start"
            >
              <UTooltip
                v-for="bug in bugs"
                :key="bug.id"
                :delay-duration="300"
                :content="{ side: 'left', sideOffset: 8 }"
                :ui="{ content: TOOLTIP_CONTENT_UI }"
              >
                <template #content>
                  <div class="w-56 space-y-3">
                    <div class="flex items-start justify-between gap-2">
                      <p class="font-bold text-sm flex items-center gap-1.5">
                        {{ bug.emoji }} {{ bug.name }}
                      </p>
                      <span
                        class="text-xs font-black rounded-full border px-2 py-0.5 shrink-0"
                        :class="[tierColor(bug.tier), tierBg(bug.tier)]"
                      >T{{ bug.tier }}</span>
                    </div>

                    <USeparator />
                    <div class="space-y-1.5">
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-xs font-bold uppercase tracking-wider text-muted">Speed</span>
                        <span
                          class="text-xs font-black tabular-nums"
                          :class="traitTextColor(bug.speed)"
                        >{{ bug.speed }}%</span>
                      </div>
                      <XenoStatLevel
                        label="Yield"
                        :level="bug.yield"
                        :max="8"
                        color="bg-info"
                      />
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-xs font-bold uppercase tracking-wider text-muted">Eat</span>
                        <span class="text-xs font-black tabular-nums text-muted">{{ bug.eat }} / cycle</span>
                      </div>
                    </div>

                    <USeparator />
                    <div class="space-y-1">
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Cycle</span>
                        <span class="font-mono">{{ formatDuration(bug.tickMs) }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Per cycle</span>
                        <span class="font-mono">{{ bug.itemEmoji }} {{ bugYieldPerCycle(bug) }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Per hour</span>
                        <span class="font-mono">{{ bug.itemEmoji }} {{ formatNumber(Math.round(bug.itemsPerHour), false) }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Coins/hr</span>
                        <CoinBalance
                          :show-icon="false"
                          :value="bug.itemsPerHour * bug.itemSellValue"
                          :compact="false"
                        />
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Eats</span>
                        <span class="font-mono">{{ formatNumber(Math.round(bug.feedPerHour), false) }}/hr</span>
                      </div>
                      <div
                        v-if="bug.socialMultiplier !== 1"
                        class="flex justify-between text-xs"
                      >
                        <span class="text-muted uppercase tracking-wider font-semibold">Neighbor speed</span>
                        <span
                          class="font-mono"
                          :class="bug.socialMultiplier > 1 ? 'text-success' : 'text-error'"
                        >{{ bug.socialMultiplier > 1 ? '+' : '' }}{{ Math.round((bug.socialMultiplier - 1) * 100) }}%</span>
                      </div>
                    </div>
                  </div>
                </template>

                <div
                  class="group relative flex flex-col rounded-xl border aspect-square w-full overflow-hidden transition-all duration-100 cursor-pointer"
                  :class="[tierBg(bug.tier), unplacingId === bug.id ? 'opacity-50 pointer-events-none' : 'hover:ring-1 hover:ring-primary/50']"
                  @click="handleUnplace(bug.id)"
                >
                  <!-- Release (hover reveal) -->
                  <button
                    class="absolute top-1.5 right-1.5 z-20 size-5 flex items-center justify-center rounded bg-black/30 opacity-0 group-hover:opacity-100 hover:bg-error hover:text-white transition-all"
                    title="Release — refunds 50% of spawn cost, plus credit for progress on the current cycle"
                    @click.stop="colony.removeBug(bug.id)"
                  >
                    <UIcon
                      name="i-lucide-x"
                      class="size-3"
                    />
                  </button>

                  <!-- Top: progress + per-cycle output -->
                  <div class="shrink-0 px-1.5 pt-1.5">
                    <div class="h-1 rounded-full bg-background overflow-hidden">
                      <div
                        class="h-full bg-primary transition-all"
                        :style="{ width: bugProgressPct(bug) + '%' }"
                      />
                    </div>
                    <p class="text-[10px] flex items-center justify-between mt-0.5">
                      <span class="text-highlighted font-medium">{{ bug.itemEmoji }} {{ bugYieldPerCycle(bug) }}</span>
                      <span class="text-muted font-mono">{{ bugCountdown(bug) }}</span>
                    </p>
                  </div>

                  <!-- Center: emoji + name + social -->
                  <div class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-0">
                    <span class="text-3xl leading-none">{{ bug.emoji }}</span>
                    <p class="text-xs font-bold text-center px-1 truncate w-full">
                      {{ bug.name }}
                    </p>
                    <span
                      v-if="bug.socialMultiplier !== 1"
                      class="text-[10px] font-bold leading-none"
                      :class="bug.socialMultiplier > 1 ? 'text-success' : 'text-error'"
                      title="Speed bonus/penalty from same-species neighbors"
                    >
                      {{ bug.social ? '👥' : '🚫' }} {{ bug.socialMultiplier > 1 ? '+' : '' }}{{ Math.round((bug.socialMultiplier - 1) * 100) }}%
                    </span>
                  </div>

                  <!-- Bottom: speed | yield | eat footer strip, matching Inventory -->
                  <div class="flex divide-x divide-default border-t border-default shrink-0">
                    <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
                      <UIcon
                        name="i-lucide-zap"
                        class="size-2.5 shrink-0"
                        :class="traitTextColor(bug.speed)"
                      />
                      <span
                        class="text-[10px] font-black tabular-nums"
                        :class="traitTextColor(bug.speed)"
                      >{{ bug.speed }}%</span>
                    </div>
                    <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
                      <UIcon
                        name="i-lucide-gem"
                        class="size-2.5 shrink-0"
                        :class="levelTextColor(bug.yield)"
                      />
                      <span
                        class="text-[10px] font-black tabular-nums"
                        :class="levelTextColor(bug.yield)"
                      >{{ bug.yield }}</span>
                    </div>
                    <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
                      <UIcon
                        name="i-lucide-utensils"
                        class="size-2.5 shrink-0 text-muted"
                      />
                      <span class="text-[10px] font-black tabular-nums text-muted">{{ bug.eat }}</span>
                    </div>
                  </div>
                </div>
              </UTooltip>
            </div>
            <p
              v-else
              class="text-sm text-muted text-center py-10 px-4"
            >
              Nothing placed yet — place bugs from the Inventory tab.
            </p>
          </template>

          <!-- Resources tab: everything foraged and claimed, at a glance -->
          <template v-if="sidebarTab === 'resources'">
            <div class="p-2 grid grid-cols-3 gap-1.5 flex-1 overflow-y-auto content-start">
              <div
                v-for="item in resourcesOwned"
                :key="item.id"
                class="relative flex flex-col rounded-xl border aspect-square w-full overflow-hidden"
                :class="[tierBg(item.tier), item.quantity <= 0 && 'opacity-50']"
              >
                <div class="flex items-center justify-between px-1.5 pt-1.5 shrink-0">
                  <span
                    class="text-[10px] font-black"
                    :class="tierColor(item.tier)"
                  >T{{ item.tier }}</span>
                  <span class="text-xs font-black text-primary leading-none">{{ formatNumber(item.quantity, false) }}</span>
                </div>
                <div class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-0">
                  <span class="text-3xl leading-none">{{ item.emoji }}</span>
                </div>
                <p class="text-xs font-bold text-center px-1 mb-1 truncate shrink-0">
                  {{ item.name }}
                </p>
                <div class="flex items-center justify-center border-t border-default py-1 shrink-0">
                  <span class="text-[10px] font-black tabular-nums text-muted">{{ formatNumber(item.sellValue, false) }} coins each</span>
                </div>
              </div>
            </div>
            <p class="text-xs text-muted text-center px-3 py-2 border-t border-default">
              Sell foraged items in the <NuxtLink
                to="/colony/market"
                class="text-primary underline"
              >Market</NuxtLink>.
            </p>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.colony-chest-float {
  animation: colony-chest-float-up 1.6s ease-out forwards;
  transform: translateX(-50%);
}

@keyframes colony-chest-float-up {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(0);
  }
  15% {
    opacity: 1;
    transform: translateX(-50%) translateY(-20px);
  }
  100% {
    opacity: 0;
    transform: translateX(-50%) translateY(-90px);
  }
}
</style>
