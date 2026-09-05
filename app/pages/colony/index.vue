<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { tierBg, tierColor, levelTextColor } from '#shared/utils/xeno'
import { avgTickYield, getBug } from '#shared/utils/colony'
import { formatDuration, traitTextColor } from '~/lib/colony-format'

const colony = useColony()
const { bugs, bugInventory, inventory, capacity, placedCount, upgrades, habitatLevel, nutrition, nutritionMax, nutritionDrainPerHour, feedCost, gemNutrition, gemBuffActive, gemFeedCost, gemFeedNutritionPerGem, initialized, pending, pendingLoot, serverNow } = colony

const sound = useColonySound()
const fx = useColonyFx()

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

const sidebarTab = ref<'inventory' | 'bugs' | 'resources'>('inventory')
const sidebarTabItems = computed(() => [
  { label: 'Bug Box', value: 'inventory', icon: 'i-lucide-package', count: bugInventory.value.reduce((s: number, b: any) => s + b.quantity, 0) },
  { label: 'Placed', value: 'bugs', icon: 'i-lucide-bug', count: bugs.value.length },
  { label: 'Storage', value: 'resources', icon: 'i-lucide-warehouse', count: inventory.value.filter((i: any) => i.quantity > 0).length }
])

const resourcesOwned = computed(() => [...inventory.value].sort((a: any, b: any) => a.tier - b.tier || a.name.localeCompare(b.name)))
const pendingLootTotal = computed(() => pendingLoot.value.reduce((sum: number, item: any) => sum + item.quantity, 0))
const pendingLootValue = computed(() => pendingLoot.value.reduce((sum: number, item: any) => sum + item.quantity * (item.sellValue ?? 0), 0))

const coinsPerHour = computed(() => bugs.value.reduce((s: number, b: any) => s + (b.itemsPerHour ?? 0) * (b.itemSellValue ?? 0), 0))
const itemsPerHour = computed(() => bugs.value.reduce((s: number, b: any) => s + (b.itemsPerHour ?? 0), 0))
const storageValue = computed(() => inventory.value.reduce((s: number, i: any) => s + i.quantity * i.sellValue, 0))

const sortedPlacedBugs = computed(() => [...bugs.value].sort((a: any, b: any) => {
  const valueDifference = (b.itemsPerHour * b.itemSellValue) - (a.itemsPerHour * a.itemSellValue)
  if (valueDifference !== 0) return valueDifference
  const tierDifference = b.tier - a.tier
  if (tierDifference !== 0) return tierDifference
  const nameDifference = a.name.localeCompare(b.name)
  return nameDifference !== 0 ? nameDifference : a.id.localeCompare(b.id)
}))

function isPrestigeOnly(typeId: string): boolean {
  return getBug(typeId)?.prestigeOnly ?? false
}

function stackTickMs(stack: any): number {
  return stack.baseTickMs * (1 - stack.speed / 100)
}
function stackItemsPerHour(stack: any): number {
  const tickMs = stackTickMs(stack)
  return tickMs > 0 ? (avgTickYield(stack.yield) / tickMs) * 3_600_000 : 0
}
function stackCoinsPerHour(stack: any): number {
  return stackItemsPerHour(stack) * (stack.itemSellValue ?? 0)
}
function stackYieldPerCycle(stack: any): string {
  return `1–${stack.yield + 1}`
}

const TOOLTIP_CONTENT_UI = 'h-auto max-w-72 p-3 flex-col items-start bg-default ring ring-default rounded-lg shadow-lg z-50'

const placingKey = ref<string | null>(null)
const unplacingId = ref<string | null>(null)

function stackKey(stack: any) {
  return `${stack.typeId}:${stack.speed}:${stack.yield}:${stack.eat}`
}

// ─── Inventory sort/filter ─────────────────────────────────────────────────
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

async function handlePlace(stack: any, ev?: MouseEvent) {
  if (placingKey.value || placedCount.value >= capacity.value) return
  placingKey.value = stackKey(stack)
  try {
    await colony.placeBug(stack.typeId, stack.speed, stack.yield, stack.eat)
    sound.play('place')
    const el = ev?.currentTarget as Element | undefined
    fx.celebrate(el, { emoji: stack.emoji, count: 6 })
    // Fly a copy of the bug into the terrarium.
    const from = fx.centerOf(el)
    const to = fx.centerOf(terrariumWrap.value)
    if (from && to) fx.float(to.x, to.y + 40, `${stack.emoji} joined!`)
  } catch {
    sound.play('error')
  } finally {
    placingKey.value = null
  }
}

async function handleUnplace(bugId: string, ev?: MouseEvent) {
  if (unplacingId.value) return
  unplacingId.value = bugId
  try {
    await colony.unplaceBug(bugId)
    sound.play('unplace')
    fx.celebrate(ev?.currentTarget as Element | undefined, { emoji: '📦', count: 4 })
  } catch {
    sound.play('error')
  } finally {
    unplacingId.value = null
  }
}

async function handleRelease(bugId: string, ev?: MouseEvent) {
  const el = ev?.currentTarget as Element | undefined
  try {
    await colony.removeBug(bugId)
    sound.play('release')
    fx.celebrate(el, { emoji: ['🪙', '👋'], count: 8 })
  } catch {
    sound.play('error')
  }
}

// ─── Nutrition ─────────────────────────────────────────────────────────────
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
const terrarium = ref<{ feedCelebration: (kind: 'coins' | 'gems') => void } | null>(null)
const terrariumWrap = ref<HTMLDivElement | null>(null)
const feedBtn = ref<HTMLButtonElement | null>(null)
const gemFeedBtn = ref<HTMLButtonElement | null>(null)

async function handleFeed() {
  if (feeding.value || !canFeed.value) return
  feeding.value = true
  try {
    await colony.feedSwarm('coins')
    sound.play('feed')
    terrarium.value?.feedCelebration('coins')
    fx.celebrate(feedBtn.value, { emoji: ['🍓', '🥕', '🍎', '🥬'], count: 10, text: 'Nom nom!' })
  } catch {
    sound.play('error')
  } finally {
    feeding.value = false
  }
}

async function handleGemFeed() {
  if (feeding.value || !canGemFeed.value) return
  feeding.value = true
  try {
    await colony.feedSwarm('gems')
    sound.play('gem-feed')
    terrarium.value?.feedCelebration('gems')
    fx.celebrate(gemFeedBtn.value, { emoji: ['💎', '✨'], count: 14, text: 'Buffed!', flash: true, color: '#38bdf8' })
  } catch {
    sound.play('error')
  } finally {
    feeding.value = false
  }
}

// Starving sting — once per transition into starving, not every frame.
watch(isStarving, (v, was) => {
  if (v && !was && initialized.value && bugs.value.length) sound.play('starving')
})

let lootRefreshHandle: ReturnType<typeof setTimeout> | null = null
function handleBugProduced() {
  if (lootRefreshHandle) clearTimeout(lootRefreshHandle)
  lootRefreshHandle = setTimeout(() => {
    void colony.refresh()
    lootRefreshHandle = null
  }, 300)
}
function handleTick() {
  sound.play('tick')
}
onUnmounted(() => {
  if (lootRefreshHandle) clearTimeout(lootRefreshHandle)
})

// ─── Loot jar ──────────────────────────────────────────────────────────────
const chestBusy = ref(false)
const lootJarEl = ref<HTMLButtonElement | null>(null)
const jarPop = ref(false)

async function handleCollect() {
  if (chestBusy.value || !pendingLoot.value.length) return
  chestBusy.value = true
  try {
    const res = await colony.collectLoot()
    const collected: any[] = res?.collected ?? []
    const total = collected.reduce((s: number, i: any) => s + i.quantity, 0)
    sound.play(total >= 200 ? 'collect-big' : 'collect')
    jarPop.value = true
    setTimeout(() => { jarPop.value = false }, 700)
    const c = fx.centerOf(lootJarEl.value)
    if (c) {
      fx.burst(c.x, c.y, { emoji: collected.map((i: any) => i.emoji), count: Math.min(24, 8 + collected.length * 3), spread: 110, size: 20 })
      if (total >= 200) fx.flash(c.x, c.y, '#f5b342')
      collected.forEach((item: any, i: number) => {
        setTimeout(() => fx.float(c.x + (Math.random() - 0.5) * 80, c.y - 20 - i * 6, `+${formatNumber(item.quantity, false)} ${item.emoji}`), i * 160)
      })
    }
  } catch {
    sound.play('error')
  } finally {
    chestBusy.value = false
  }
}

const founding = ref(false)
async function handleInit() {
  founding.value = true
  try {
    await colony.initColony()
    sound.play('found')
    fx.flash(undefined, undefined, '#f5b342')
  } finally {
    founding.value = false
  }
}

// ─── Live progress ─────────────────────────────────────────────────────────
const nowTick = ref(Date.now())
let progressInterval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  progressInterval = setInterval(() => { nowTick.value = Date.now() }, 500)
})
onUnmounted(() => {
  if (progressInterval) clearInterval(progressInterval)
})

const liveFoodSpent = computed(() => {
  const elapsedMs = Math.max(0, nowTick.value - serverNow.value)
  return bugs.value.reduce((sum: number, bug: any) => {
    if (!bug.tickMs || bug.tickMs <= 0) return sum
    const completedCycles = Math.floor((bug.tickProgressMs + elapsedMs) / bug.tickMs)
    const foodPerCycle = Math.round(bug.feedPerHour * bug.tickMs / 3_600_000)
    return sum + completedCycles * foodPerCycle
  }, 0)
})
const liveGemNutrition = computed(() => Math.max(0, gemNutrition.value - liveFoodSpent.value))
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

function bugCountdown(bug: any) {
  if (isStarving.value) return 'Starving'
  const elapsed = Math.max(0, nowTick.value - bugsSyncedAt.value)
  const total = bug.tickProgressMs + elapsed
  const remaining = bug.tickMs - (total % bug.tickMs)
  const secs = Math.max(0, Math.ceil(remaining / 1000))
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${secs}s`
}

function bugYieldPerCycle(bug: any): string {
  const min = Math.round(bug.itemsPerTickMin ?? 1)
  const max = Math.round(bug.itemsPerTickMax ?? bug.yield + 1)
  return max > min ? `${min}–${max}` : `${min}`
}

function onHover() {
  sound.play('hover')
}
</script>

<template>
  <div class="p-3 md:p-5 w-full">
    <!-- ── Founding screen ─────────────────────────────────────────────── -->
    <div
      v-if="!pending && !initialized"
      class="relative flex flex-col items-center justify-center py-20 gap-6 text-center overflow-hidden"
    >
      <div class="relative">
        <div class="absolute inset-0 rounded-full bg-primary/20 blur-3xl scale-150" />
        <ColonyLogo
          :size="140"
          class="relative colony-bob drop-shadow-2xl"
        />
      </div>
      <div class="relative">
        <p class="colony-eyebrow mb-2">
          A new idle empire awaits
        </p>
        <h1 class="text-3xl colony-title colony-glow-text">
          Found your <span class="text-primary">Colony</span>
        </h1>
        <p class="text-sm text-muted max-w-md mt-3">
          Colony is a late-game idle world for established players — bugs start at {{ formatNumber(66000) }} coins and pay for themselves over days of foraging. Found the colony, buy your first bugs in the Market, keep them fed, and watch the jar fill up.
        </p>
      </div>
      <div class="relative flex flex-wrap items-center justify-center gap-3 text-2xl">
        <span
          v-for="(e, i) in ['🐛', '🪲', '🦗', '🕷️', '🪳', '🐝']"
          :key="e"
          class="colony-bob"
          :style="{ animationDelay: `${i * 0.2}s` }"
        >{{ e }}</span>
      </div>
      <button
        class="colony-btn colony-btn-lg colony-btn-pulse relative"
        :disabled="founding"
        @click="handleInit"
      >
        <UIcon
          name="i-lucide-sprout"
          class="size-5"
        />
        Found Colony
      </button>
    </div>

    <template v-else>
      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_24rem] gap-4 max-w-full overflow-x-hidden">
        <!-- ── Left: stats, terrarium, feeding station ─────────────────── -->
        <div class="space-y-3 min-w-0">
          <!-- Stat strip -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 colony-slide-in">
            <div class="colony-stat">
              <span class="colony-eyebrow flex items-center gap-1">
                <UIcon
                  name="i-lucide-trending-up"
                  class="size-3 text-amber-400"
                />Income
              </span>
              <span class="colony-stat-value colony-amber-text">+{{ formatNumber(coinsPerHour) }}<span class="text-xs text-muted font-bold">/h</span></span>
            </div>
            <div class="colony-stat">
              <span class="colony-eyebrow flex items-center gap-1">
                <UIcon
                  name="i-lucide-package-plus"
                  class="size-3 text-info"
                />Forage
              </span>
              <span class="colony-stat-value">{{ formatNumber(Math.round(itemsPerHour), false) }}<span class="text-xs text-muted font-bold"> items/h</span></span>
            </div>
            <div class="colony-stat">
              <span class="colony-eyebrow flex items-center gap-1">
                <UIcon
                  name="i-lucide-bug"
                  class="size-3 text-primary"
                />Placed
              </span>
              <span
                class="colony-stat-value"
                :class="placedCount >= capacity ? 'text-warning' : ''"
              >{{ placedCount }}<span class="text-xs text-muted font-bold"> / {{ capacity }}</span></span>
            </div>
            <div class="colony-stat">
              <span class="colony-eyebrow flex items-center gap-1">
                <UIcon
                  name="i-lucide-warehouse"
                  class="size-3 text-success"
                />Storage
              </span>
              <span class="colony-stat-value flex items-center gap-1">
                <CoinBalance
                  :value="storageValue"
                  :show-icon="false"
                />
              </span>
            </div>
          </div>

          <!-- Terrarium -->
          <div
            ref="terrariumWrap"
            class="relative"
          >
            <ClientOnly>
              <ColonyTerrariumCanvas
                ref="terrarium"
                :bugs="bugs"
                :is-starving="isStarving"
                :has-spare-bugs="!!bugInventory.length"
                :upgrades="upgrades"
                :habitat-level="habitatLevel"
                :gem-buff-active="gemBuffActive"
                @produced="handleBugProduced"
                @tick="handleTick"
              >
                <!-- Loot jar lives inside the terrarium, bottom-left -->
                <button
                  ref="lootJarEl"
                  data-no-snack
                  class="group absolute bottom-3 left-3 z-20 flex items-end gap-2 rounded-2xl px-2 py-1.5 transition-transform"
                  :class="[pendingLoot.length ? 'cursor-pointer hover:scale-105' : 'cursor-default', jarPop ? 'colony-levelup' : '']"
                  :disabled="chestBusy || !pendingLoot.length"
                  :title="pendingLoot.length ? 'Collect the loot jar' : 'Nothing foraged yet'"
                  @click.stop="handleCollect"
                  @mouseenter="pendingLoot.length && onHover()"
                >
                  <ColonyLootJar
                    :items="pendingLoot"
                    :size="76"
                  />
                  <div class="mb-1 rounded-xl border border-white/10 bg-black/55 px-2.5 py-1.5 text-left backdrop-blur-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-white/60">
                      Loot jar
                    </p>
                    <p
                      v-if="pendingLoot.length"
                      class="text-sm font-black text-amber-300 leading-tight"
                    >
                      {{ formatNumber(pendingLootTotal, false) }} items
                    </p>
                    <p
                      v-else
                      class="text-xs font-bold text-white/50"
                    >
                      Empty
                    </p>
                    <p
                      v-if="pendingLoot.length"
                      class="text-[10px] font-bold text-white/70 flex items-center gap-1"
                    >
                      ≈ <CoinBalance
                        :value="pendingLootValue"
                        :show-icon="false"
                      /> 🪙 · click to collect
                    </p>
                  </div>
                </button>
              </ColonyTerrariumCanvas>
              <template #fallback>
                <div class="h-[460px] w-full animate-pulse rounded-3xl border border-default bg-elevated" />
              </template>
            </ClientOnly>
          </div>

          <!-- Feeding station -->
          <div
            class="colony-panel p-3 sm:p-4 space-y-2.5"
            :class="isStarving ? 'colony-panel-amber colony-shake' : gemBuffActive ? 'colony-panel-accent' : ''"
          >
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-2">
                <span class="text-xl">{{ isStarving ? '🥣' : nutritionLow ? '🍽️' : '🍯' }}</span>
                <div>
                  <p class="text-sm font-black flex items-center gap-2">
                    Feeding station
                    <span
                      v-if="gemBuffActive"
                      class="colony-chip colony-chip-ok"
                      style="color: #7dd3fc; border-color: rgba(56,189,248,.45); background: rgba(56,189,248,.1)"
                      title="Gem-fed nutrition is active: +1 yield and +20% speed, colony-wide, until it runs out."
                    >💎 Buffed</span>
                  </p>
                  <p
                    class="text-xs"
                    :class="isStarving ? 'text-error font-bold' : nutritionLow ? 'text-warning' : 'text-muted'"
                  >
                    <template v-if="isStarving">
                      Everyone's starving — foraging has stopped until you feed them.
                    </template>
                    <template v-else-if="nutritionEtaMs !== null">
                      Runs dry in {{ formatDuration(nutritionEtaMs) }} (around {{ nutritionEtaClock }}).
                    </template>
                    <template v-else>
                      Nobody's eating right now.
                    </template>
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  ref="gemFeedBtn"
                  class="colony-btn colony-btn-info colony-btn-sm"
                  :disabled="!canGemFeed || feeding"
                  :title="`Each gem adds ${formatNumber(gemFeedNutritionPerGem, false)} nutrition and grants +1 yield and +20% speed colony-wide while it lasts.`"
                  @click="handleGemFeed"
                  @mouseenter="onHover"
                >
                  <UIcon
                    name="i-lucide-gem"
                    class="size-3.5"
                  />
                  {{ gemFeedCost <= 0 ? 'Full' : `${formatNumber(gemFeedCost, false)} 💎` }}
                </button>
                <button
                  ref="feedBtn"
                  class="colony-btn"
                  :class="[isStarving || nutritionLow ? 'colony-btn-pulse' : '', feedCost <= 0 ? 'colony-btn-ghost' : '']"
                  :disabled="!canFeed || feeding"
                  @click="handleFeed"
                  @mouseenter="onHover"
                >
                  <UIcon
                    name="i-lucide-utensils"
                    class="size-4"
                  />
                  <template v-if="feedCost <= 0">
                    Tank full
                  </template>
                  <span
                    v-else
                    class="flex items-center gap-1"
                  >
                    Feed · <CoinBalance
                      :value="feedCost"
                      :compact="false"
                      :show-icon="false"
                    /> 🪙
                  </span>
                </button>
              </div>
            </div>
            <ColonyTank
              :value="liveNutrition"
              :gem-value="liveGemNutrition"
              :max="nutritionMax"
              :starving="isStarving"
              :low="nutritionLow"
            >
              {{ formatNumber(Math.round(liveTotalNutrition), false) }} / {{ formatNumber(nutritionMax, false) }}
            </ColonyTank>
          </div>
        </div>

        <!-- ── Right: Bug Box ──────────────────────────────────────────── -->
        <div class="colony-panel overflow-hidden flex flex-col colony-slide-in xl:sticky xl:top-3 xl:max-h-[calc(100vh-2rem)]">
          <div class="flex items-center justify-between px-3 py-2.5 border-b border-default">
            <span class="text-xs font-black uppercase tracking-widest text-muted flex items-center gap-1.5">
              <span class="text-base">🧰</span> Bug Box
            </span>
            <span
              class="colony-chip"
              :class="placedCount >= capacity ? 'colony-chip-amber' : ''"
            >{{ placedCount }} / {{ capacity }} slots</span>
          </div>

          <div class="flex gap-1 px-2 pt-2 border-b border-default">
            <button
              v-for="t in sidebarTabItems"
              :key="t.value"
              class="flex-1 flex items-center justify-center gap-1.5 rounded-t-xl px-2 py-2 text-xs font-bold transition-colors border border-b-0"
              :class="sidebarTab === t.value ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted border-transparent hover:text-default hover:bg-elevated/60'"
              @click="sidebarTab = t.value as any; sound.play('click')"
            >
              <UIcon
                :name="t.icon"
                class="size-3.5"
              />
              <span class="hidden sm:inline">{{ t.label }}</span>
              <span
                class="rounded-full px-1.5 text-[10px] font-black"
                :class="sidebarTab === t.value ? 'bg-primary text-white' : 'bg-elevated text-muted'"
              >{{ t.count }}</span>
            </button>
          </div>

          <!-- Bug Box tab -->
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
              <span class="text-4xl block mb-2 opacity-60">📦</span>
              <p class="text-sm font-bold">
                No spare bugs.
              </p>
              <p class="text-xs text-muted mt-1">
                Buy some in the Market and they'll show up here, ready to place.
              </p>
              <NuxtLink
                to="/colony/market"
                class="colony-btn colony-btn-sm mt-3"
              >
                <UIcon
                  name="i-lucide-store"
                  class="size-3.5"
                />
                Open Market
              </NuxtLink>
            </div>

            <div
              v-else-if="!filteredSortedBugInventory.length"
              class="py-10 text-center px-4"
            >
              <span class="text-4xl block mb-2 opacity-60">🔍</span>
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
                    <p class="text-[10px] text-primary font-bold text-center">
                      Click to place in the terrarium
                    </p>
                  </div>
                </template>

                <button
                  class="colony-tile"
                  :class="[tierBg(stack.tier), placingKey === stackKey(stack) ? 'ring-2 ring-primary' : '']"
                  :disabled="placedCount >= capacity || !!placingKey"
                  @click="handlePlace(stack, $event)"
                  @mouseenter="onHover"
                >
                  <span class="absolute top-1 left-1.5 text-[10px] font-black text-primary">×{{ stack.quantity }}</span>
                  <span
                    class="absolute top-1 right-1.5 text-[10px] font-black"
                    :class="tierColor(stack.tier)"
                  >T{{ stack.tier }}</span>
                  <div class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-0">
                    <span class="colony-tile-emoji">{{ stack.emoji }}</span>
                  </div>
                  <p class="text-[11px] font-bold text-center px-1 mb-1 truncate shrink-0">
                    {{ stack.name }}
                  </p>
                  <div class="flex divide-x divide-default border-t border-default shrink-0 bg-black/10">
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
              class="text-xs text-warning font-bold text-center px-3 py-2 border-t border-default flex items-center justify-center gap-1"
            >
              <UIcon
                name="i-lucide-alert-triangle"
                class="size-3.5"
              />
              Terrarium full — expand Capacity in the <NuxtLink
                to="/colony/habitat"
                class="underline"
              >Habitat</NuxtLink>.
            </p>
          </template>

          <!-- Placed tab -->
          <template v-if="sidebarTab === 'bugs'">
            <div
              v-if="bugs.length"
              class="p-2 grid grid-cols-3 gap-1.5 flex-1 overflow-y-auto content-start"
            >
              <UTooltip
                v-for="bug in sortedPlacedBugs"
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
                      <div
                        v-if="bug.resourceMultiplier > 1"
                        class="flex items-center justify-between gap-3"
                      >
                        <span class="text-xs font-bold uppercase tracking-wider text-muted">Research</span>
                        <span class="text-xs font-black tabular-nums text-primary">×{{ bug.resourceMultiplier }} resources</span>
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
                    <p class="text-[10px] text-primary font-bold text-center">
                      Click to move back to the Bug Box
                    </p>
                  </div>
                </template>

                <div
                  class="group colony-tile cursor-pointer"
                  :class="[tierBg(bug.tier), unplacingId === bug.id ? 'opacity-50 pointer-events-none' : '']"
                  @click="handleUnplace(bug.id, $event)"
                  @mouseenter="onHover"
                >
                  <button
                    v-if="!isPrestigeOnly(bug.typeId)"
                    class="absolute top-1.5 right-1.5 z-20 size-5 flex items-center justify-center rounded-md bg-black/40 opacity-0 group-hover:opacity-100 hover:bg-error hover:text-white transition-all"
                    title="Release — refunds 50% of spawn cost, plus credit for progress on the current cycle"
                    @click.stop="handleRelease(bug.id, $event)"
                  >
                    <UIcon
                      name="i-lucide-x"
                      class="size-3"
                    />
                  </button>

                  <div class="shrink-0 px-1.5 pt-1.5">
                    <div class="colony-bar !h-1.5">
                      <div
                        class="colony-bar-fill"
                        :class="isStarving ? 'colony-bar-fill-error' : ''"
                        :style="{ width: bugProgressPct(bug) + '%' }"
                      />
                    </div>
                    <p class="text-[10px] flex items-center justify-between mt-0.5">
                      <span class="text-highlighted font-bold">{{ bug.itemEmoji }} {{ bugYieldPerCycle(bug) }}</span>
                      <span
                        class="font-mono"
                        :class="isStarving ? 'text-error' : 'text-muted'"
                      >{{ bugCountdown(bug) }}</span>
                    </p>
                  </div>

                  <div class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-0">
                    <span
                      class="colony-tile-emoji"
                      :class="isStarving ? 'grayscale opacity-60' : ''"
                    >{{ bug.emoji }}</span>
                    <p class="text-[11px] font-bold text-center px-1 truncate w-full">
                      {{ bug.name }}
                    </p>
                    <span
                      v-if="bug.socialMultiplier !== 1"
                      class="text-[10px] font-black leading-none"
                      :class="bug.socialMultiplier > 1 ? 'text-success' : 'text-error'"
                      title="Speed bonus/penalty from same-species neighbors"
                    >
                      {{ bug.social ? '👥' : '🚫' }} {{ bug.socialMultiplier > 1 ? '+' : '' }}{{ Math.round((bug.socialMultiplier - 1) * 100) }}%
                    </span>
                  </div>

                  <div class="flex divide-x divide-default border-t border-default shrink-0 bg-black/10">
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
            <div
              v-else
              class="py-10 text-center px-4"
            >
              <span class="text-4xl block mb-2 opacity-60">🫙</span>
              <p class="text-sm text-muted">
                Nothing placed yet — pick a bug from the Bug Box.
              </p>
            </div>
          </template>

          <!-- Storage tab -->
          <template v-if="sidebarTab === 'resources'">
            <div class="p-2 grid grid-cols-3 gap-1.5 flex-1 overflow-y-auto content-start">
              <div
                v-for="item in resourcesOwned"
                :key="item.id"
                class="colony-tile"
                :class="[tierBg(item.tier), item.quantity <= 0 && 'opacity-40 grayscale']"
              >
                <div class="flex items-center justify-between px-1.5 pt-1.5 shrink-0">
                  <span
                    class="text-[10px] font-black"
                    :class="tierColor(item.tier)"
                  >T{{ item.tier }}</span>
                  <span class="text-xs font-black text-primary leading-none">{{ formatNumber(item.quantity, false) }}</span>
                </div>
                <div class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-0">
                  <span class="text-3xl leading-none drop-shadow">{{ item.emoji }}</span>
                </div>
                <p class="text-[11px] font-bold text-center px-1 mb-1 truncate shrink-0">
                  {{ item.name }}
                </p>
                <div class="flex items-center justify-center border-t border-default py-1 shrink-0 bg-black/10">
                  <CoinBalance
                    class="text-[10px] font-black tabular-nums text-muted"
                    :value="item.sellValue"
                    :compact="false"
                    :show-icon="false"
                  />
                  <span class="text-[10px] font-black text-muted ml-1">ea</span>
                </div>
              </div>
            </div>
            <div class="px-3 py-2 border-t border-default flex items-center justify-between gap-2">
              <span class="text-xs text-muted flex items-center gap-1">
                Worth <CoinBalance
                  :value="storageValue"
                  class="font-bold"
                />
              </span>
              <NuxtLink
                to="/colony/market"
                class="colony-btn colony-btn-sm"
              >
                <UIcon
                  name="i-lucide-coins"
                  class="size-3.5"
                />
                Sell
              </NuxtLink>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
