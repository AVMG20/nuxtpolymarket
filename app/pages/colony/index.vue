<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { avgTickYield, bugStackKey, getBug, getItem, releaseAllButBest, releaseRefund, REMOVE_REFUND_RATE } from '#shared/utils/colony'
import { formatDuration } from '~/lib/colony-format'

const colony = useColony()
const { bugs, bugInventory, inventory, capacity, placedCount, upgrades, habitatLevel, nutrition, nutritionMax, nutritionDrainPerHour, feedCost, gemNutrition, gemFeedCost, gemFeedNutritionPerGem, initialized, pending, pendingLoot, serverNow } = colony

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

type BurrowTab = 'spare' | 'placed' | 'stores'
const burrowTab = ref<BurrowTab>('spare')

const resourcesOwned = computed(() => [...inventory.value].sort((a: any, b: any) => a.tier - b.tier || a.name.localeCompare(b.name)))
const storesValue = computed(() => inventory.value.reduce((sum: number, item: any) => sum + item.quantity * item.sellValue, 0))
const spareCount = computed(() => bugInventory.value.reduce((sum: number, stack: any) => sum + stack.quantity, 0))
const terrariumFull = computed(() => placedCount.value >= capacity.value)

/** Keep the placed-bugs grid stable across production refreshes. Average coin
 * output is the primary ordering; the remaining fields make equal-value bugs
 * deterministic instead of inheriting an arbitrary database response order. */
const sortedPlacedBugs = computed(() => [...bugs.value].sort((a: any, b: any) => {
  const valueDifference = (b.itemsPerHour * b.itemSellValue) - (a.itemsPerHour * a.itemSellValue)
  if (valueDifference !== 0) return valueDifference

  const tierDifference = b.tier - a.tier
  if (tierDifference !== 0) return tierDifference

  const nameDifference = a.name.localeCompare(b.name)
  return nameDifference !== 0 ? nameDifference : a.id.localeCompare(b.id)
}))

/** Prestige-shop grants cannot be released — the server refuses it. */
function isPrestigeOnly(typeId: string): boolean {
  return getBug(typeId)?.prestigeOnly ?? false
}

function stackKey(stack: any) {
  return bugStackKey(stack)
}

/** A placed bug the server hasn't confirmed yet: it can't be moved or released until it has. */
function isPendingBug(bug: any): boolean {
  return bug.id.startsWith(PENDING_BUG_PREFIX)
}

// ─── Spare bug sort/filter ─────────────────────────────────────────────────
type SortKey = 'tier' | 'yield' | 'speed' | 'quantity' | 'name'
const sortChips: { label: string, value: SortKey }[] = [
  { label: 'Tier', value: 'tier' },
  { label: 'Yield', value: 'yield' },
  { label: 'Speed', value: 'speed' },
  { label: 'Qty', value: 'quantity' },
  { label: 'Name', value: 'name' }
]
const inventorySortBy = ref<SortKey>('tier')
const inventorySortDir = ref<'desc' | 'asc'>('desc')
const inventoryFilterType = ref('all')

/** Tap a sort chip to sort by it; tap the active one again to flip the direction. */
function pickSort(key: SortKey) {
  if (inventorySortBy.value === key) inventorySortDir.value = inventorySortDir.value === 'desc' ? 'asc' : 'desc'
  else {
    inventorySortBy.value = key
    inventorySortDir.value = key === 'name' ? 'asc' : 'desc'
  }
}

const inventoryFilterOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const stack of bugInventory.value) {
    if (!seen.has(stack.typeId)) seen.set(stack.typeId, `${stack.emoji} ${stack.name}`)
  }
  return [
    { label: 'All species', value: 'all' },
    ...Array.from(seen, ([value, label]) => ({ label, value }))
  ]
})

watch(inventoryFilterOptions, (options) => {
  if (!options.some(o => o.value === inventoryFilterType.value)) inventoryFilterType.value = 'all'
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

// Both apply locally at once (see useColony), so the next click doesn't wait
// on the server; a failed request is undone there.
function handlePlace(stack: any) {
  if (placedCount.value >= capacity.value) return
  colony.placeBug(stack.typeId, stack.speed, stack.yield, stack.eat).catch(() => {})
}

// ─── Fill: place the best spare bugs in every free slot ────────────────────
// Each place is its own request through the same optimistic queue as a tap;
// the server locks the colony row and refuses a place past capacity.
function stackCoinsPerHour(stack: any): number {
  const tickMs = stack.baseTickMs * (1 - stack.speed / 100)
  if (tickMs <= 0) return 0
  return (avgTickYield(stack.yield) * (stack.resourceMultiplier ?? 1) / tickMs) * 3_600_000 * (stack.itemSellValue ?? 0)
}

const fillPlan = computed(() => {
  let left = Math.max(0, capacity.value - placedCount.value)
  const plan: { stack: any, count: number }[] = []
  const ranked = [...bugInventory.value].sort((a: any, b: any) =>
    Number(!!b.producesGems) - Number(!!a.producesGems)
    || stackCoinsPerHour(b) - stackCoinsPerHour(a)
    || b.tier - a.tier)
  for (const stack of ranked) {
    if (left <= 0) break
    const count = Math.min(stack.quantity, left)
    plan.push({ stack, count })
    left -= count
  }
  return plan
})
const fillCount = computed(() => fillPlan.value.reduce((sum, step) => sum + step.count, 0))

function fillTerrarium() {
  for (const { stack, count } of fillPlan.value) {
    for (let i = 0; i < count; i++) handlePlace(stack)
  }
}

function handleUnplace(bugId: string) {
  colony.unplaceBug(bugId).catch(() => {})
}

// Releasing a placed bug takes a second tap on its ✕ within a few seconds.
const armedRemoveId = ref<string | null>(null)
let armedRemoveTimer: ReturnType<typeof setTimeout> | null = null
function disarmRemove() {
  if (armedRemoveTimer) clearTimeout(armedRemoveTimer)
  armedRemoveTimer = null
  armedRemoveId.value = null
}
function handleRemove(bugId: string) {
  if (armedRemoveId.value !== bugId) {
    disarmRemove()
    armedRemoveId.value = bugId
    armedRemoveTimer = setTimeout(disarmRemove, 3000)
    return
  }
  disarmRemove()
  colony.removeBug(bugId).catch(() => {})
}
onUnmounted(disarmRemove)

// ─── Release mode (Spare tab) ──────────────────────────────────────────────
// Tapping a stack picks all of it; the stepper on the card trims the count.
// Releasing takes a second step: a summary sheet the player confirms.
const releaseMode = ref(false)
const releasePicks = ref<Record<string, number>>({})
const releaseConfirm = ref(false)

const releaseCount = computed(() => Object.values(releasePicks.value).reduce((sum, n) => sum + n, 0))
const releaseTotalRefund = computed(() => bugInventory.value.reduce((sum: number, stack: any) =>
  sum + releaseRefund(stack.typeId, releasePicks.value[stackKey(stack)] ?? 0), 0))
const releaseSummary = computed(() => (bugInventory.value as any[])
  .filter(stack => pickedFor(stack) > 0)
  .map(stack => ({ stack, count: pickedFor(stack), refund: releaseRefund(stack.typeId, pickedFor(stack)) })))

function resetReleaseConfirm() {
  releaseConfirm.value = false
}
function setPicks(picks: Record<string, number>) {
  releasePicks.value = picks
  resetReleaseConfirm()
}
function toggleReleaseMode() {
  releaseMode.value = !releaseMode.value
  // All / Keep best pick across the whole inventory, so release mode always
  // shows every stack: nothing hidden by a species filter gets released.
  if (releaseMode.value) inventoryFilterType.value = 'all'
  setPicks({})
}
function pickedFor(stack: any): number {
  return releasePicks.value[stackKey(stack)] ?? 0
}
function togglePick(stack: any) {
  if (isPrestigeOnly(stack.typeId)) return
  const { [stackKey(stack)]: current, ...rest } = releasePicks.value
  setPicks(current ? rest : { ...rest, [stackKey(stack)]: stack.quantity })
}
function stepPick(stack: any, delta: number) {
  const { [stackKey(stack)]: current = 0, ...rest } = releasePicks.value
  const next = Math.max(0, Math.min(stack.quantity, current + delta))
  setPicks(next ? { ...rest, [stackKey(stack)]: next } : rest)
}
function pickAllButBest() {
  setPicks(releaseAllButBest(bugInventory.value as any[]))
}
function pickAll() {
  setPicks(Object.fromEntries((bugInventory.value as any[])
    .filter(stack => !isPrestigeOnly(stack.typeId))
    .map(stack => [stackKey(stack), stack.quantity])))
}

interface FloatText { id: number, text: string, x: number }
let floatSeq = 0
const releaseFloats = ref<FloatText[]>([])

function confirmRelease() {
  if (!releaseCount.value) return
  if (!releaseConfirm.value) {
    releaseConfirm.value = true
    return
  }
  const stacks = (bugInventory.value as any[])
    .filter(stack => pickedFor(stack) > 0)
    .map(stack => ({ typeId: stack.typeId, speed: stack.speed, yield: stack.yield, eat: stack.eat, quantity: pickedFor(stack) }))
  const refund = releaseTotalRefund.value
  releaseMode.value = false
  setPicks({})
  colony.releaseBugs(stacks)
    .then(() => {
      const id = floatSeq++
      releaseFloats.value.push({ id, text: `+${formatNumber(refund)}`, x: 50 })
      setTimeout(() => {
        releaseFloats.value = releaseFloats.value.filter(f => f.id !== id)
      }, 1800)
    })
    .catch(() => {})
}

function onStackActivate(stack: any) {
  if (releaseMode.value) togglePick(stack)
  else handlePlace(stack)
}

// Keep picks in step with the inventory: a stack that shrank or vanished
// (placed, released elsewhere, reconciled) caps or drops its pick.
watch(bugInventory, (inv: any[]) => {
  if (!inv.length) releaseMode.value = false
  const picks: Record<string, number> = {}
  for (const stack of inv) {
    const n = Math.min(stack.quantity, releasePicks.value[stackKey(stack)] ?? 0)
    if (n > 0) picks[stackKey(stack)] = n
  }
  const keys = Object.keys(picks)
  if (keys.length !== Object.keys(releasePicks.value).length || keys.some(k => releasePicks.value[k] !== picks[k])) setPicks(picks)
})

function selectBurrowTab(tab: BurrowTab) {
  burrowTab.value = tab
  if (tab !== 'spare' && releaseMode.value) toggleReleaseMode()
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

let lootRefreshHandle: ReturnType<typeof setTimeout> | null = null

function handleBugProduced() {
  if (lootRefreshHandle) clearTimeout(lootRefreshHandle)
  lootRefreshHandle = setTimeout(() => {
    void colony.refresh()
    lootRefreshHandle = null
  }, 300)
}

onUnmounted(() => {
  if (lootRefreshHandle) clearTimeout(lootRefreshHandle)
})

// ─── Loot chest ─────────────────────────────────────────────────────────────

const chestFloats = ref<FloatText[]>([])
const chestBusy = ref(false)

async function handleCollect() {
  if (chestBusy.value) return
  chestBusy.value = true
  // The chest's contents are already known, so they float up right away; the
  // server's list is only needed when the chest looked empty.
  const known = pendingLoot.value.map((l: any) => ({ ...l }))
  if (known.length) floatLoot(known)
  try {
    const res = await colony.collectLoot()
    if (!known.length) floatLoot(res?.collected ?? [])
  } finally {
    chestBusy.value = false
  }
}

function floatLoot(collected: any[]) {
  // stagger each popup's appearance so they don't all stack on top of
  // each other — pushed one at a time instead of all at once
  collected.forEach((item: any, i: number) => {
    setTimeout(() => {
      const id = floatSeq++
      const x = 50 + (Math.random() - 0.5) * 70
      chestFloats.value.push({ id, text: `+${formatNumber(item.quantity, false)} ${item.emoji}`, x })
      setTimeout(() => {
        chestFloats.value = chestFloats.value.filter(f => f.id !== id)
      }, 1700)
    }, i * 220)
  })
}

const pendingLootValue = computed(() => pendingLoot.value.reduce((sum: number, loot: any) =>
  sum + loot.quantity * (getItem(loot.itemTypeId)?.sellValue ?? 0), 0))

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

/** Mirror server settlement between polls: food is spent only when a bug's
 * displayed cycle completes, with premium nutrition consumed first. */
const liveFoodSpent = computed(() => colonyFoodSpent(bugs.value, serverNow.value, nowTick.value))

const liveGemNutrition = computed(() => {
  return Math.max(0, gemNutrition.value - liveFoodSpent.value)
})
const liveNutrition = computed(() => {
  const spillover = Math.max(0, liveFoodSpent.value - gemNutrition.value)
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

function bugRemainingMs(bug: any) {
  const elapsed = Math.max(0, nowTick.value - bugsSyncedAt.value)
  const total = bug.tickProgressMs + elapsed
  return bug.tickMs - (total % bug.tickMs)
}

function bugCountdown(bug: any) {
  if (isStarving.value) return 'Starving'
  const secs = Math.max(0, Math.ceil(bugRemainingMs(bug) / 1000))
  if (secs >= 3600) return formatDuration(secs * 1000)
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${secs}s`
}

// ─── Colony pulse ───────────────────────────────────────────────────────────

const incomePerHour = computed(() => isStarving.value
  ? 0
  : bugs.value.reduce((sum: number, bug: any) => sum + (getBug(bug.typeId)?.producesGems ? 0 : bug.itemsPerHour * bug.itemSellValue), 0))

/** The gem forager closest to finishing its ~24h cycle. */
const nextGemBug = computed(() => {
  const gemBugs: any[] = bugs.value.filter((bug: any) => bug.gemsPerCycle)
  if (!gemBugs.length) return null
  return gemBugs.reduce((best: any, bug: any) => bugRemainingMs(bug) < bugRemainingMs(best) ? bug : best)
})

/** Loot worth half an hour of foraging (or any, while nothing forages) makes the chest overflow. */
const chestOverflowing = computed(() => pendingLootValue.value > 0 && pendingLootValue.value >= incomePerHour.value * 0.5)
</script>

<template>
  <div class="px-4 py-4 md:p-6 w-full">
    <!-- Not founded yet -->
    <div
      v-if="!pending && !initialized"
      class="max-w-xl mx-auto py-10 sm:py-16"
    >
      <div class="cl-panel px-5 py-8 sm:p-10 text-center flex flex-col items-center gap-4 overflow-hidden">
        <div class="cl-jar w-full max-w-sm">
          <div class="cl-scene h-36 terrarium-preview grid place-items-center">
            <span class="text-6xl">🐛</span>
          </div>
        </div>
        <div>
          <h1 class="cl-display text-3xl font-semibold">
            Found your colony
          </h1>
          <p class="text-sm text-muted max-w-sm mt-2">
            An idle bug empire for established players. Species start at {{ formatNumber(66000) }} coins and pay for themselves over days of foraging. Hatch bugs, keep them fed, collect their forage and dig the burrow deeper.
          </p>
        </div>
        <button
          type="button"
          class="cl-btn cl-btn-green"
          @click="handleInit"
        >
          <UIcon
            name="i-lucide-sprout"
            class="size-5"
          />
          Found Colony
        </button>
      </div>
    </div>

    <div
      v-else-if="!initialized"
      class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem] gap-5"
      aria-busy="true"
    >
      <div class="space-y-4">
        <div class="cl-panel h-28 animate-pulse" />
        <div class="cl-jar p-2 sm:p-3">
          <div class="cl-scene terrarium-preview h-[340px] sm:h-[460px] animate-pulse" />
        </div>
      </div>
      <div class="cl-panel h-96 animate-pulse" />
    </div>

    <div
      v-else
      class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem] gap-5 items-start"
    >
      <!-- Left: trough, jar, pulse -->
      <section class="flex flex-col gap-4 min-w-0">
        <ColonyNutritionTrough
          :nutrition="liveNutrition"
          :gem-nutrition="liveGemNutrition"
          :max="nutritionMax"
          :drain-per-hour="nutritionDrainPerHour"
          :feed-cost="feedCost"
          :gem-feed-cost="gemFeedCost"
          :gem-nutrition-per-gem="gemFeedNutritionPerGem"
          :can-feed="canFeed"
          :can-gem-feed="canGemFeed"
          :feeding="feeding"
          @feed="handleFeed"
          @gem-feed="handleGemFeed"
        />

        <!-- The terrarium jar -->
        <div class="cl-jar p-1.5 sm:p-2 mb-5 sm:mb-9">
          <div
            class="cl-scene"
            :class="[isStarving && bugs.length && 'cl-scene-starving', liveGemNutrition > 0 && 'cl-scene-buffed']"
          >
            <ClientOnly>
              <ColonyTerrariumCanvas
                :bugs="bugs"
                :is-starving="isStarving"
                :has-spare-bugs="!!bugInventory.length"
                :upgrades="upgrades"
                :habitat-level="habitatLevel"
                :show-legend="!pendingLoot.length"
                @produced="handleBugProduced"
              />
              <template #fallback>
                <div class="terrarium-preview h-[340px] sm:h-[460px] w-full animate-pulse" />
              </template>
            </ClientOnly>

            <!-- Slots -->
            <div class="cl-plaque top-3 right-3 min-w-24 sm:min-w-36">
              <div class="flex justify-between gap-2.5">
                <span class="text-muted">Slots</span>
                <span
                  class="cl-display cl-num text-sm"
                  :class="terrariumFull ? 'text-amber-300' : ''"
                >{{ placedCount }} / {{ capacity }}</span>
              </div>
              <div class="hidden sm:flex flex-wrap gap-0.5 mt-1.5 max-w-36">
                <span
                  v-for="i in capacity"
                  :key="i"
                  class="h-1.5 w-2.5 rounded-sm"
                  :class="i <= placedCount ? 'bg-green-400/80' : 'bg-white/10'"
                />
              </div>
            </div>


            <template v-if="isStarving && bugs.length">
              <div class="cl-scene-vignette" />
              <div class="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 z-[18] w-[min(22rem,calc(100%-2rem))] text-center px-5 py-3.5 rounded-xl bg-[rgba(30,10,8,0.9)] border border-red-400/35">
                <p class="cl-display text-xl sm:text-[22px] font-semibold text-red-300">
                  Your colony is starving
                </p>
                <p class="text-[13px] text-red-200 mt-0.5">
                  All {{ bugs.length }} {{ bugs.length === 1 ? 'bug' : 'bugs' }} stopped foraging. Feed them to wake them up.
                </p>
                <button
                  type="button"
                  class="cl-btn cl-btn-red cl-btn-sm mt-2.5"
                  :disabled="!canFeed || feeding"
                  @click="handleFeed"
                >
                  Feed ·
                  <ColonyCurrencyIcon :size="15" />
                  {{ formatNumber(feedCost, false) }}
                </button>
              </div>
            </template>
          </div>

          <!-- Loot chest docked on the jar -->
          <ColonyLootChest
            class="absolute z-[25] right-3 -bottom-5 sm:right-6 sm:-bottom-10"
            :loot="pendingLoot"
            :overflowing="chestOverflowing"
            :busy="chestBusy"
            :floats="chestFloats"
            @collect="handleCollect"
          />
        </div>

        <!-- Colony pulse -->
        <div class="grid grid-cols-3 gap-2 sm:gap-3">
          <div class="cl-panel px-3 py-2.5 sm:px-3.5 sm:py-3 min-w-0">
            <p class="cl-eyebrow truncate">
              Income
            </p>
            <p class="cl-display cl-num text-lg sm:text-[22px] font-semibold text-green-400 leading-tight">
              <template v-if="isStarving && bugs.length">
                <span class="text-red-300">Paused</span>
              </template>
              <template v-else>
                ≈ {{ formatNumber(incomePerHour) }} <span class="block sm:inline text-xs sm:text-[13px] text-muted">coins / hr</span>
              </template>
            </p>
          </div>
          <div class="cl-panel px-3 py-2.5 sm:px-3.5 sm:py-3 min-w-0">
            <p class="cl-eyebrow truncate">
              Appetite
            </p>
            <p class="cl-display cl-num text-lg sm:text-[22px] font-semibold leading-tight">
              {{ formatNumber(Math.round(nutritionDrainPerHour)) }} <span class="block sm:inline text-xs sm:text-[13px] text-muted">nutrition / hr</span>
            </p>
          </div>
          <div
            v-if="nextGemBug"
            class="cl-panel px-3 py-2.5 sm:px-3.5 sm:py-3 min-w-0 border-sky-400/40"
          >
            <p class="cl-eyebrow truncate">
              {{ nextGemBug.name }} {{ nextGemBug.emoji }}
            </p>
            <p class="cl-display cl-num text-lg sm:text-[22px] font-semibold text-sky-300 leading-tight">
              +{{ nextGemBug.gemsPerCycle }} <span class="block sm:inline text-xs sm:text-[13px] text-muted">{{ isStarving ? 'gems, paused' : `gems in ${formatDuration(bugRemainingMs(nextGemBug))}` }}</span>
            </p>
          </div>
          <div
            v-else
            class="cl-panel px-3 py-2.5 sm:px-3.5 sm:py-3 min-w-0"
          >
            <p class="cl-eyebrow truncate">
              Stores worth
            </p>
            <p class="cl-display cl-num text-lg sm:text-[22px] font-semibold text-amber-400 leading-tight">
              {{ formatNumber(storesValue) }} <span class="block sm:inline text-xs sm:text-[13px] text-muted">coins</span>
            </p>
          </div>
        </div>
      </section>

      <!-- Right: the Burrow -->
      <aside
        class="cl-panel p-3 sm:p-3.5 flex flex-col gap-3 min-w-0"
        aria-label="The Burrow"
      >
        <div class="relative flex items-center justify-between gap-2.5">
          <div class="min-w-0">
            <h2 class="cl-display text-xl font-semibold">
              The Burrow
            </h2>
            <p class="text-[12.5px] text-muted">
              Spare bugs wait here until you place them.
            </p>
          </div>
          <span
            class="cl-chip cl-num shrink-0"
            :class="terrariumFull && 'cl-chip-warn'"
          >{{ placedCount }} / {{ capacity }} placed</span>
          <span
            v-for="f in releaseFloats"
            :key="f.id"
            class="cl-float cl-float-gold top-0"
            :style="{ left: f.x + '%' }"
          >{{ f.text }}</span>
        </div>

        <div
          class="cl-seg"
          role="tablist"
          aria-label="Burrow"
        >
          <button
            type="button"
            role="tab"
            class="cl-seg-btn"
            :class="burrowTab === 'spare' && 'cl-seg-on'"
            :aria-selected="burrowTab === 'spare'"
            @click="selectBurrowTab('spare')"
          >
            Spare <span class="cl-num opacity-80">{{ formatNumber(spareCount) }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="cl-seg-btn"
            :class="burrowTab === 'placed' && 'cl-seg-on'"
            :aria-selected="burrowTab === 'placed'"
            @click="selectBurrowTab('placed')"
          >
            <span class="hidden min-[400px]:inline">In terrarium</span><span class="min-[400px]:hidden">Placed</span> <span class="cl-num opacity-80">{{ placedCount }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="cl-seg-btn"
            :class="burrowTab === 'stores' && 'cl-seg-on'"
            :aria-selected="burrowTab === 'stores'"
            @click="selectBurrowTab('stores')"
          >
            Stores
          </button>
        </div>

        <!-- Spare -->
        <template v-if="burrowTab === 'spare'">
          <template v-if="bugInventory.length">
            <!-- One frame for both modes, so switching never moves the cards below -->
            <div
              class="cl-toolbar flex flex-col gap-2"
              :class="releaseMode && 'cl-toolbar-release'"
            >
              <template v-if="!releaseMode">
                <div class="grid grid-cols-5 gap-1.5">
                  <button
                    v-for="chip in sortChips"
                    :key="chip.value"
                    type="button"
                    class="cl-chip justify-center gap-1 !px-1 min-w-0"
                    :class="inventorySortBy === chip.value && 'cl-chip-gold'"
                    :aria-pressed="inventorySortBy === chip.value"
                    @click="pickSort(chip.value)"
                  >
                    {{ chip.label }}
                    <UIcon
                      v-if="inventorySortBy === chip.value"
                      :name="inventorySortDir === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'"
                      class="size-3"
                    />
                  </button>
                </div>
                <div class="flex items-center gap-2 min-h-[34px]">
                  <USelect
                    v-if="inventoryFilterOptions.length > 2"
                    v-model="inventoryFilterType"
                    :items="inventoryFilterOptions"
                    size="sm"
                    class="flex-1 min-w-0"
                    :ui="{ content: 'cl-theme' }"
                    aria-label="Filter by species"
                  />
                  <span
                    v-else
                    class="flex-1"
                  />
                  <button
                    type="button"
                    class="cl-btn cl-btn-green cl-btn-sm shrink-0"
                    :disabled="!fillCount"
                    :title="fillCount ? 'Place your best spare bugs (by coins per hour) in every free slot' : terrariumFull ? 'The terrarium is full' : 'No spare bugs to place'"
                    @click="fillTerrarium"
                  >
                    <UIcon
                      name="i-lucide-arrow-down-to-line"
                      class="size-4"
                    />
                    Fill{{ fillCount ? ` ${fillCount}` : '' }}
                  </button>
                  <button
                    type="button"
                    class="cl-btn cl-btn-ghost cl-btn-sm shrink-0"
                    @click="toggleReleaseMode"
                  >
                    <UIcon
                      name="i-lucide-leaf"
                      class="size-4 text-amber-400"
                    />
                    Release
                  </button>
                </div>
                <p class="text-[12.5px] text-muted">
                  <template v-if="terrariumFull">
                    Full. Raise <NuxtLink
                      to="/colony/habitat"
                      class="text-amber-400 underline"
                    >Terrarium Capacity</NuxtLink> in the Habitat.
                  </template>
                  <template v-else>
                    Tap a card to place it in the terrarium.
                  </template>
                </p>
              </template>

              <template v-else>
                <div class="flex items-center gap-2 min-h-[30px]">
                  <p class="flex-1 min-w-0 flex items-center gap-1.5 font-semibold text-amber-200 truncate">
                    <UIcon
                      name="i-lucide-leaf"
                      class="size-4 shrink-0"
                    />
                    <span
                      v-if="releaseCount"
                      class="cl-num truncate"
                    >{{ formatNumber(releaseCount, false) }} {{ releaseCount === 1 ? 'bug' : 'bugs' }} · +{{ formatNumber(Math.round(releaseTotalRefund)) }}</span>
                    <span
                      v-else
                      class="truncate"
                    >Release mode</span>
                  </p>
                  <button
                    type="button"
                    class="cl-btn cl-btn-gold cl-btn-xs shrink-0"
                    :disabled="!releaseCount"
                    @click="confirmRelease"
                  >
                    Release{{ releaseCount ? ` ${formatNumber(releaseCount)}` : '' }}
                  </button>
                </div>
                <div class="flex items-center gap-1.5 sm:gap-2 min-h-[34px]">
                  <button
                    type="button"
                    class="cl-btn cl-btn-ghost cl-btn-sm shrink-0 px-2.5 sm:px-3"
                    title="Pick every stack except the best of each species"
                    @click="pickAllButBest"
                  >
                    <UIcon
                      name="i-lucide-crown"
                      class="size-4 text-amber-400"
                    />
                    Keep best
                  </button>
                  <button
                    type="button"
                    class="cl-btn cl-btn-ghost cl-btn-sm shrink-0 px-2.5 sm:px-3"
                    @click="pickAll"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="cl-btn cl-btn-ghost cl-btn-sm shrink-0 px-2.5 sm:px-3"
                    :disabled="!releaseCount"
                    @click="setPicks({})"
                  >
                    None
                  </button>
                  <span class="flex-1" />
                  <button
                    type="button"
                    class="cl-btn cl-btn-ghost cl-btn-sm shrink-0 px-2.5 sm:px-3"
                    @click="toggleReleaseMode"
                  >
                    Done
                  </button>
                </div>
                <p class="text-[12.5px] text-amber-100/85">
                  Pick stacks to free them for a {{ Math.round(REMOVE_REFUND_RATE * 100) }}% refund.
                </p>
              </template>
            </div>

            <div
              v-if="filteredSortedBugInventory.length"
              class="grid grid-cols-3 gap-2 sm:gap-2.5 content-start xl:max-h-[min(68vh,760px)] xl:overflow-y-auto xl:-mx-1 xl:px-1 xl:pt-1 xl:pb-2"
            >
              <ColonyStackCard
                v-for="stack in filteredSortedBugInventory"
                :key="stackKey(stack)"
                :stack="stack"
                :release-mode="releaseMode"
                :picked="pickedFor(stack)"
                :prestige="isPrestigeOnly(stack.typeId)"
                :full="terrariumFull"
                @activate="onStackActivate(stack)"
                @step="stepPick(stack, $event)"
              />
            </div>
            <div
              v-else
              class="py-10 text-center"
            >
              <UIcon
                name="i-lucide-filter-x"
                class="size-8 text-muted/40 mx-auto mb-2"
              />
              <p class="text-sm text-muted">
                No bugs match this filter.
              </p>
            </div>
          </template>

          <div
            v-else
            class="py-10 text-center px-4"
          >
            <span class="text-4xl opacity-50">🥚</span>
            <p class="cl-display text-base font-semibold mt-2">
              No spare bugs
            </p>
            <p class="text-xs text-muted mt-1">
              Hatch more in the <NuxtLink
                to="/colony/market"
                class="text-amber-400 underline"
              >Market</NuxtLink>.
            </p>
          </div>
        </template>

        <!-- In the terrarium -->
        <template v-if="burrowTab === 'placed'">
          <template v-if="bugs.length">
            <p class="text-[12.5px] text-muted">
              Sorted by coins per hour. Tap a bug to send it back to the Burrow.
            </p>
            <div class="grid grid-cols-3 gap-2 sm:gap-2.5 content-start xl:max-h-[min(72vh,820px)] xl:overflow-y-auto xl:-mx-1 xl:px-1 xl:pt-1 xl:pb-2">
              <ColonyPlacedCard
                v-for="bug in sortedPlacedBugs"
                :key="bug.id"
                :bug="bug"
                :progress="bugProgressPct(bug)"
                :countdown="bugCountdown(bug)"
                :starving="isStarving"
                :pending="isPendingBug(bug)"
                :prestige="isPrestigeOnly(bug.typeId)"
                :armed="armedRemoveId === bug.id"
                @unplace="handleUnplace(bug.id)"
                @release="handleRemove(bug.id)"
              />
            </div>
          </template>
          <p
            v-else
            class="text-sm text-muted text-center py-10 px-4"
          >
            Nothing placed yet. Place bugs from the Spare tab.
          </p>
        </template>

        <!-- Stores -->
        <template v-if="burrowTab === 'stores'">
          <NuxtLink
            to="/colony/market?tab=trading"
            class="cl-btn cl-btn-gold cl-btn-sm w-full"
          >
            <UIcon
              name="i-lucide-scale"
              class="size-4"
            />
            Sell in the Trading Post · ≈ {{ formatNumber(storesValue) }}
          </NuxtLink>
          <div class="grid grid-cols-3 gap-2 sm:gap-2.5">
            <div
              v-for="item in resourcesOwned"
              :key="item.id"
              class="cl-crate"
              :class="[`cl-t${item.tier}`, item.quantity <= 0 && 'cl-crate-empty']"
            >
              <span class="self-stretch flex justify-between text-xs font-semibold cl-num">
                <span class="cl-tc">T{{ item.tier }}</span>
                <span class="text-muted">{{ formatNumber(item.sellValue) }} ea</span>
              </span>
              <span class="text-[32px] leading-tight">{{ item.emoji }}</span>
              <span class="cl-display cl-num text-xl font-semibold">{{ formatNumber(item.quantity) }}</span>
              <span class="text-xs font-semibold text-muted text-center leading-tight">{{ item.name }}</span>
            </div>
          </div>
        </template>
      </aside>
    </div>

    <!-- Confirm release: a bottom sheet on phones -->
    <ColonyConfirmSheet
      :open="releaseConfirm && releaseCount > 0"
      :title="`Set ${formatNumber(releaseCount, false)} ${releaseCount === 1 ? 'bug' : 'bugs'} free?`"
      description="They return to the wild. You get half of what you paid."
      @close="resetReleaseConfirm"
    >
      <div class="cl-inset px-3 py-1.5">
        <div
          v-for="row in releaseSummary"
          :key="stackKey(row.stack)"
          class="flex items-center gap-2.5 py-2 border-b border-[#5a4431]/50"
        >
          <span class="text-2xl">{{ row.stack.emoji }}</span>
          <span class="flex-1 min-w-0 font-semibold truncate">
            {{ row.stack.name }}
            <span class="text-muted font-semibold">· {{ row.stack.speed }}% · Y{{ row.stack.yield }} · eats {{ row.stack.eat }}</span>
          </span>
          <span class="cl-display cl-num font-semibold">×{{ row.count }}</span>
          <span class="cl-num font-semibold text-amber-400 min-w-16 text-right">+{{ formatNumber(row.refund) }}</span>
        </div>
        <div class="flex justify-between items-center pt-2.5 pb-1.5 font-semibold">
          <span>Total refund</span>
          <span class="cl-display cl-num text-xl text-amber-400">{{ formatNumber(Math.round(releaseTotalRefund), false) }}</span>
        </div>
      </div>
      <template #actions="{ ready }">
        <button
          type="button"
          class="cl-btn cl-btn-ghost"
          @click="resetReleaseConfirm"
        >
          Keep them
        </button>
        <button
          type="button"
          class="cl-btn cl-btn-gold"
          @click="ready && confirmRelease()"
        >
          Release {{ formatNumber(releaseCount, false) }} {{ releaseCount === 1 ? 'bug' : 'bugs' }}
        </button>
      </template>
    </ColonyConfirmSheet>
  </div>
</template>

<style scoped>
.terrarium-preview {
  background: linear-gradient(180deg, #2a3a22 0%, #1f2a1a 7%, #4a3221 7.6%, #3d2a1c 30%, #33231a 30.5%, #2b1e15 58%, #24190f 58.6%, #1b130d 100%);
}
</style>
