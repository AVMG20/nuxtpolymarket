<script setup lang="ts">
import { tierNameColor, tierBg, tierColor, getPlantDisplay, effectiveGrowTime, plantBuyPrice, PLANT_TYPES, XENO_UPGRADE_TRACKS, xenoUpgradeCost } from '#shared/utils/xeno'
import { formatDuration } from '~/lib/xeno-format'

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

const { inventory, sellPlants, unlockedTypeIds, buyPlants, hybrids, rollHybrid, upgrades, buyUpgrade, refresh, fetchSession } = useXeno()
const sound = useXenoSound()
const fx = useXenoFx()
const toast = useToast()

type Tab = 'sell' | 'buy' | 'hybrids' | 'upgrades'
const activeTab = ref<Tab>('sell')
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'sell', label: 'Sell', icon: 'i-lucide-coins' },
  { id: 'buy', label: 'Buy', icon: 'i-lucide-shopping-bag' },
  { id: 'hybrids', label: 'Hybrids', icon: 'i-lucide-dna' },
  { id: 'upgrades', label: 'Upgrades', icon: 'i-lucide-chart-no-axes-combined' },
]
function setTab(t: Tab) {
  if (activeTab.value === t) return
  activeTab.value = t
  sound.play('select')
}

const buyingUpgrade = ref<string | null>(null)
function upgradeLevel(id: 'mutation' | 'yield' | 'speed'): number {
  return upgrades.value[id]
}
async function doBuyUpgrade(id: 'mutation' | 'yield' | 'speed', e: MouseEvent) {
  buyingUpgrade.value = id
  try {
    await buyUpgrade(id)
    sound.play('unlock')
    fx.burst(e.clientX, e.clientY, { count: 12, spread: 60 })
  } catch { sound.play('error') } finally { buyingUpgrade.value = null }
}

// ── Hybrid gamble state ──────────────────────────────────────────────────────
const rolling = ref(false)
const reelSpinning = ref(false)
const reelIcon = ref<string>('sprout')
const lastRoll = ref<any>(null)
const recentRolls = ref<any[]>([])
const reelEl = ref<HTMLElement | null>(null)

const hybridPool = computed(() => PLANT_TYPES.filter(p => p.tier <= Math.max(1, hybrids.value.tier) && !p.voidPlant).map(p => p.id))

async function doRollHybrid() {
  if (rolling.value || gems.value < hybrids.value.costGems) return
  rolling.value = true
  reelSpinning.value = true
  lastRoll.value = null
  // Spin the reel while the request is in flight, then keep it going a beat so
  // the reveal never lands before the eye has registered the spin.
  const pool = hybridPool.value
  const spin = setInterval(() => {
    reelIcon.value = pool[Math.floor(Math.random() * pool.length)] ?? 'sprout'
    sound.play('tick')
  }, 70)
  const minSpin = new Promise(r => setTimeout(r, 1100))
  try {
    const [res] = await Promise.all([rollHybrid(), minSpin]) as [any, unknown]
    clearInterval(spin)
    reelSpinning.value = false
    if (res?.result) {
      lastRoll.value = res.result
      recentRolls.value = [res.result, ...recentRolls.value].slice(0, 12)
      const quad = res.result.isHybrid && res.result.resources.length >= 4
      sound.play(quad ? 'mutation' : res.result.isHybrid ? 'roll-win' : 'collect')
      const c = fx.centerOf(reelEl.value)
      if (c) {
        fx.burst(c.x, c.y, { count: quad ? 24 : 12, spread: quad ? 120 : 70, plantId: res.result.resources[0]?.id })
        if (quad) fx.flash(c.x, c.y)
      }
    }
  } catch {
    clearInterval(spin)
    reelSpinning.value = false
    sound.play('error')
  } finally {
    rolling.value = false
  }
}

const searchQuery = ref('')
const tierFilter = ref(0)
const tierOptions = [{ label: 'All tiers', value: 0 }, ...Array.from({ length: 9 }, (_, i) => ({ label: `T${i + 1}`, value: i + 1 }))]

// ── Keep setting (cookie-persisted) ─────────────────────────────────────────
const keepAmount = useCookie<number>('xeno_market_keep', { default: () => 20 })
const keepInput = computed({
  get: () => keepAmount.value,
  set: (v) => { keepAmount.value = Math.max(0, Math.floor(Number(v) || 0)) },
})

const filteredInventory = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return (inventory.value || [])
    .filter((item: any) => {
      if (tierFilter.value !== 0 && item.tier !== tierFilter.value) return false
      if (q && !item.name.toLowerCase().includes(q)) return false
      return true
    })
    .sort((a: any, b: any) => b.value - a.value)
})

function keepSellQty(item: any): number {
  return item.isHybrid ? 0 : Math.max(0, item.quantity - keepAmount.value)
}
const keepSellableItems = computed(() => filteredInventory.value.filter((item: any) => keepSellQty(item) > 0))
const keepSellTotalValue = computed(() => keepSellableItems.value.reduce((sum: number, item: any) => sum + item.value * keepSellQty(item), 0))

const buyablePlants = computed(() => {
  const unlocked = new Set(unlockedTypeIds.value)
  const q = searchQuery.value.toLowerCase()
  return PLANT_TYPES
    .filter(p => {
      if (!unlocked.has(p.id)) return false
      if (tierFilter.value !== 0 && p.tier !== tierFilter.value) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
    .map(p => ({ ...p, buyPrice: plantBuyPrice(p) }))
    .sort((a, b) => b.tier !== a.tier ? b.tier - a.tier : b.value - a.value)
})

const totalInventoryValue = computed(() => (inventory.value || []).reduce((sum: number, item: any) => sum + item.value * item.quantity, 0))

const selling = ref<Record<string, boolean>>({})
const buying = ref<Record<string, boolean>>({})
const sellingKeepAll = ref(false)

const confirmSell = ref<{ item: any; qty: number } | null>(null)
const confirmKeepSellAll = ref(false)

function stackKey(item: any) {
  return `${item.typeId}:${item.speed}:${item.yield}`
}

function requestSell(item: any, qty: number) {
  if (qty >= item.quantity) confirmSell.value = { item, qty }
  else doSell(item, qty)
}

function coinsAt(e?: MouseEvent | null, amount?: number) {
  if (!e) return
  fx.burst(e.clientX, e.clientY, { count: 8, spread: 40, color: '#facc15' })
  if (amount != null) fx.float(e.clientX, e.clientY - 8, Math.round(amount), { emoji: '🪙', colorClass: 'text-yellow-300' })
}

let lastClick: MouseEvent | null = null
function trackClick(e: MouseEvent) { lastClick = e }

async function doSell(item: any, qty: number) {
  confirmSell.value = null
  const key = `${stackKey(item)}-${qty}`
  selling.value[key] = true
  try {
    const res = await sellPlants(item.typeId, item.speed, item.yield, qty)
    sound.play('coins')
    coinsAt(lastClick, res?.total)
  } catch { sound.play('error') } finally { delete selling.value[key] }
}

async function doSellKeep(item: any) {
  const qty = keepSellQty(item)
  if (qty <= 0) return
  const key = `keep-${stackKey(item)}`
  selling.value[key] = true
  try {
    const res = await sellPlants(item.typeId, item.speed, item.yield, qty)
    sound.play('coins')
    coinsAt(lastClick, res?.total)
  } catch { sound.play('error') } finally { delete selling.value[key] }
}

async function doSellKeepAll() {
  confirmKeepSellAll.value = false
  sellingKeepAll.value = true
  try {
    // One state refresh + one session fetch for the whole batch instead of
    // one per stack — a 40-stack sell-all used to fire 80 follow-up requests.
    const results = await Promise.allSettled(
      keepSellableItems.value.map((item: any) => sellPlants(item.typeId, item.speed, item.yield, keepSellQty(item), { refresh: false })),
    )
    await Promise.all([refresh(), fetchSession()])
    const total = results.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value?.total ?? 0) : 0), 0)
    const sold = results.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value?.sold ?? 0) : 0), 0)
    if (sold) {
      toast.add({ title: `Sold ${sold} plants for $${formatNumber(total, false)}`, color: 'success' })
      sound.play('harvest-big')
      coinsAt(lastClick, total)
    }
    if (results.some(r => r.status === 'rejected')) sound.play('error')
  } finally {
    sellingKeepAll.value = false
  }
}

async function doBuy(typeId: string, qty: number, e: MouseEvent) {
  const key = `${typeId}-${qty}`
  buying.value[key] = true
  try {
    await buyPlants(typeId, qty)
    sound.play('buy')
    fx.burst(e.clientX, e.clientY, { count: 8, spread: 40, plantId: typeId })
  } catch { sound.play('error') } finally { delete buying.value[key] }
}

function growTime(item: any) {
  const base = getPlantDisplay(item.typeId ?? item.id)
  return base ? formatDuration(effectiveGrowTime({ baseTime: base.baseTime, speed: item.speed })) : '?'
}

function rollTier(roll: any): number {
  if (!roll.isHybrid) return roll.resources[0].tier
  return roll.resources.length >= 4 ? 7 : Math.max(...roll.resources.map((r: any) => r.tier))
}
</script>

<template>
  <UContainer class="pt-6" @click.capture="trackClick">
    <!-- Header -->
    <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
      <h1 class="text-2xl font-black tracking-tight">Market</h1>
      <div class="xeno-panel xeno-panel-accent rounded-2xl px-4 py-2.5 text-right shrink-0">
        <p class="xeno-eyebrow">Portfolio value</p>
        <CoinBalance :value="totalInventoryValue" :compact="false" class="text-xl font-black justify-end" />
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex flex-wrap gap-1 mb-5">
      <button
        v-for="t in tabs" :key="t.id"
        class="xeno-tab"
        :class="activeTab === t.id ? 'xeno-tab-active' : ''"
        @click="setTab(t.id)"
      >
        <UIcon :name="t.icon" class="size-4" />
        {{ t.label }}
        <UIcon v-if="t.id === 'hybrids' && !hybrids.unlocked" name="i-lucide-lock" class="size-3 opacity-60" />
      </button>
    </div>

    <!-- Filters -->
    <div v-if="activeTab === 'sell' || activeTab === 'buy'" class="flex gap-2 mb-4">
      <UInput v-model="searchQuery" placeholder="Search plants…" icon="i-lucide-search" size="sm" class="flex-1" />
      <USelect v-model="tierFilter" :items="tierOptions" size="sm" class="w-28" />
    </div>

    <!-- ── SELL TAB ── -->
    <div v-if="activeTab === 'sell'">
      <div class="xeno-panel flex flex-wrap items-center gap-3 mb-4 px-4 py-2.5 rounded-2xl">
        <UIcon name="i-lucide-settings-2" class="size-3.5 text-muted shrink-0" />
        <span class="text-xs text-muted font-medium shrink-0">Keep per stack</span>
        <UInput v-model="keepInput" type="number" min="0" size="xs" class="w-20" />
        <div class="flex-1" />
        <div v-if="keepSellTotalValue > 0" class="flex items-center gap-1.5 text-xs text-muted shrink-0">
          <span>surplus worth</span>
          <CoinBalance :value="keepSellTotalValue" :compact="false" class="font-bold text-default" />
        </div>
        <UButton
          size="xs" color="error" variant="soft" icon="i-lucide-trending-down"
          :label="`Sell surplus — keep ${keepAmount}`"
          :disabled="keepSellableItems.length === 0 || sellingKeepAll"
          :loading="sellingKeepAll"
          @click="confirmKeepSellAll = true"
        />
      </div>

      <div v-if="!inventory" class="space-y-2">
        <USkeleton v-for="i in 4" :key="i" class="h-20 rounded-xl" />
      </div>

      <div v-else class="space-y-2">
        <div v-if="!filteredInventory.length" class="xeno-panel rounded-2xl text-sm text-muted py-12 text-center">
          {{ inventory.length ? 'No plants match your filter.' : 'No plants in inventory — harvest something first.' }}
        </div>

        <div
          v-for="item in filteredInventory"
          :key="stackKey(item)"
          class="xeno-lift rounded-2xl border px-4 py-3 flex items-center gap-4"
          :class="tierBg(item.tier)"
        >
          <UTooltip :delay-duration="300" :content="{ side: 'bottom', align: 'end', sideOffset: 6 }" :ui="{ content: 'h-auto p-0 bg-transparent ring-0 shadow-none' }">
            <template #content>
              <XenoPlantTooltipContent
                :name="item.name" :tier="item.tier" :color="item.color" :speed="item.speed" :yield="item.yield"
                :base-time="item.baseTime" :value="item.value" :description="item.description" :quantity="item.quantity"
                :is-hybrid="item.isHybrid" :resources="item.resources"
              />
            </template>
            <div class="shrink-0 flex items-center gap-2 cursor-default">
              <div class="relative">
                <XenoPlantIcon :id="item.typeId ?? item.id" :size="40" />
                <span class="absolute -bottom-1 -right-1 rounded-full bg-background border border-default px-1 text-[10px] font-black text-primary tabular-nums leading-4">×{{ item.quantity }}</span>
              </div>
            </div>
          </UTooltip>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <p class="font-bold text-sm" :class="tierNameColor(item.tier)">{{ item.name }}</p>
              <span v-if="item.isHybrid" class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 leading-none shrink-0">Hybrid</span>
              <XenoTierLabel :tier="item.tier" />
              <span v-if="item.isHybrid" class="flex items-center gap-0.5 text-sm">
                <XenoPlantIcon v-for="(r, i) in item.resources" :key="i" :id="r.id" :size="16" />
              </span>
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <template v-if="!item.isHybrid">
                <XenoLevelBadge prefix="S" :level="item.speed" />
                <XenoLevelBadge prefix="Y" :level="item.yield" />
              </template>
              <span class="text-xs text-muted">~{{ growTime(item) }}</span>
            </div>
          </div>

          <div class="text-right shrink-0 hidden sm:flex flex-col items-end gap-0.5">
            <template v-if="item.isHybrid">
              <p class="text-xs text-muted italic">vessel</p>
              <p class="text-[10px] text-muted/60">no sell value</p>
            </template>
            <template v-else>
              <CoinBalance :value="item.value * item.quantity" :compact="false" class="text-sm font-bold tabular-nums" />
              <div class="text-xs text-muted tabular-nums flex items-center gap-1"><CoinBalance :value="item.value" :compact="false" :show-icon="false" /> ea</div>
            </template>
          </div>

          <div v-if="!item.isHybrid" class="flex gap-1 shrink-0">
            <UButton
              v-for="qty in [1, 10, 50]" :key="qty"
              size="xs" variant="soft" color="error"
              :disabled="item.quantity === 0"
              :loading="selling[`${stackKey(item)}-${Math.min(qty, item.quantity)}`]"
              @click="requestSell(item, Math.min(qty, item.quantity))"
            >
              <span class="tabular-nums font-semibold">×{{ qty }}</span>
            </UButton>
            <UButton
              size="xs" variant="soft" color="error"
              :disabled="keepSellQty(item) === 0"
              :loading="selling[`keep-${stackKey(item)}`]"
              :label="`−${keepAmount}`"
              :title="`Sell everything above ${keepAmount}`"
              @click="doSellKeep(item)"
            />
          </div>
          <p v-else class="text-[11px] text-muted shrink-0 hidden sm:block">Plant it on the grid to harvest resources</p>
        </div>
      </div>
    </div>

    <!-- ── BUY TAB ── -->
    <div v-else-if="activeTab === 'buy'">
      <div v-if="!unlockedTypeIds.length" class="xeno-panel rounded-2xl text-sm text-muted py-12 text-center">
        Harvest plants from the garden first to unlock them for purchase.
      </div>

      <div v-else class="space-y-2">
        <div v-if="!buyablePlants.length" class="xeno-panel rounded-2xl text-sm text-muted py-12 text-center">No unlocked plants match your filter.</div>

        <div v-for="plant in buyablePlants" :key="plant.id" class="xeno-lift rounded-2xl border px-4 py-3 flex items-center gap-4" :class="tierBg(plant.tier)">
          <UTooltip :delay-duration="300" :content="{ side: 'bottom', align: 'end', sideOffset: 6 }" :ui="{ content: 'h-auto p-0 bg-transparent ring-0 shadow-none' }">
            <template #content>
              <XenoPlantTooltipContent :name="plant.name" :tier="plant.tier" :color="plant.color" :speed="plant.speed" :yield="plant.yield" :base-time="plant.baseTime" :value="plant.value" :description="plant.description" />
            </template>
            <div class="shrink-0 flex flex-col items-center gap-1.5 w-10 cursor-default">
              <XenoPlantIcon :id="plant.id" :size="40" />
            </div>
          </UTooltip>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <p class="font-bold text-sm" :class="tierNameColor(plant.tier)">{{ plant.name }}</p>
              <XenoTierLabel :tier="plant.tier" />
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <XenoLevelBadge prefix="S" :level="plant.speed" />
              <XenoLevelBadge prefix="Y" :level="plant.yield" />
              <span class="text-xs text-muted">~{{ formatDuration(effectiveGrowTime({ baseTime: plant.baseTime, speed: plant.speed })) }}</span>
            </div>
          </div>

          <div class="text-right shrink-0 hidden sm:block">
            <div class="text-xs text-muted tabular-nums flex items-center gap-1"><CoinBalance :value="plant.buyPrice" :compact="false" /> ea</div>
          </div>

          <div class="flex gap-1 shrink-0">
            <UButton
              v-for="qty in [1, 10, 100]" :key="qty"
              size="xs" variant="soft" color="success"
              :disabled="balance < plant.buyPrice * qty"
              :loading="buying[`${plant.id}-${qty}`]"
              :title="`${formatNumber(plant.buyPrice * qty, false)} coins`"
              @click="(e: MouseEvent) => doBuy(plant.id, qty, e)"
            >
              <span class="tabular-nums font-semibold">×{{ qty }}</span>
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ── HYBRIDS TAB ── -->
    <div v-else-if="activeTab === 'hybrids'">
      <!-- Locked -->
      <div v-if="!hybrids.unlocked" class="xeno-panel rounded-3xl flex flex-col items-center justify-center py-14 px-6 gap-4 text-center">
        <div class="relative">
          <div class="absolute inset-0 rounded-full bg-primary/15 blur-2xl" />
          <XenoDnaHelix :width="160" :height="60" class="relative opacity-70" />
        </div>
        <h2 class="text-lg font-black">Hybrid vendor sealed</h2>
        <p class="text-sm text-muted max-w-sm">
          Discover <span class="font-bold text-primary">every T{{ hybrids.unlockTier }} plant</span> to open the vault —
          a single vessel that harvests up to 4 different resources at once.
        </p>
        <div v-if="hybrids.nextTierProgress" class="rounded-2xl border border-default bg-elevated/40 p-4 text-left w-full max-w-md">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-bold uppercase tracking-wider text-muted">Discover all T{{ hybrids.nextTierProgress.tier }} plants</p>
            <span class="text-xs font-black tabular-nums">{{ hybrids.nextTierProgress.unlocked }}/{{ hybrids.nextTierProgress.total }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2.5">
            <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${(hybrids.nextTierProgress.unlocked / hybrids.nextTierProgress.total) * 100}%` }" />
          </div>
          <div v-if="hybrids.nextTierProgress.missing.length" class="flex flex-wrap items-center gap-1.5">
            <span class="text-[10px] text-muted uppercase tracking-wider font-semibold">Still need</span>
            <span v-for="m in hybrids.nextTierProgress.missing" :key="m.id" class="inline-flex items-center gap-1 text-xs rounded-md border border-default bg-background/50 px-1.5 py-0.5">
              <XenoPlantIcon :id="m.id" :size="14" class="xeno-silhouette" /><span class="text-muted">{{ m.name }}</span>
            </span>
          </div>
        </div>
      </div>

      <!-- Gamble panel -->
      <div v-else class="space-y-5">
        <div class="xeno-panel xeno-panel-accent rounded-3xl p-6 text-center relative overflow-hidden">
          <div class="absolute -top-20 left-1/2 -translate-x-1/2 size-72 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
          <div class="relative">
            <h2 class="text-xl font-black">Roll a T{{ hybrids.tier }} Hybrid</h2>
            <p class="text-sm text-muted mt-1 max-w-md mx-auto">
              1–4 random resources (≈5% for a quad) from any plant up to <span class="font-semibold text-default">T{{ hybrids.tier }}</span>,
              each with its own speed &amp; yield up to {{ hybrids.tier }}. Hybrids can't be bred — farm and sell what they grow.
            </p>

            <!-- Reel -->
            <div ref="reelEl" class="mx-auto mt-5 relative size-36 flex items-center justify-center">
              <svg viewBox="0 0 144 144" class="absolute inset-0" aria-hidden="true">
                <circle cx="72" cy="72" r="66" fill="none" stroke="var(--ui-primary)" stroke-opacity="0.25" stroke-width="2" stroke-dasharray="6 8" :class="reelSpinning ? 'xeno-orbit' : ''" style="transform-origin: 72px 72px" />
                <circle cx="72" cy="72" r="56" fill="none" stroke="var(--ui-primary)" stroke-opacity="0.5" stroke-width="1.5" stroke-dasharray="3 10" class="xeno-orbit-rev" style="transform-origin: 72px 72px" />
                <circle cx="72" cy="72" r="46" fill="color-mix(in srgb, var(--ui-bg-elevated) 80%, transparent)" stroke="var(--ui-border)" />
              </svg>
              <div class="relative">
                <div v-if="reelSpinning" class="xeno-reel-spin">
                  <XenoPlantIcon :id="reelIcon" :size="56" />
                </div>
                <div v-else-if="lastRoll" :key="recentRolls.length" class="xeno-reveal flex items-center justify-center">
                  <div v-if="lastRoll.isHybrid" class="grid gap-0.5" :class="lastRoll.resources.length > 1 ? 'grid-cols-2' : ''">
                    <XenoPlantIcon v-for="r in lastRoll.resources" :key="r.id" :id="r.id" :size="lastRoll.resources.length > 1 ? 30 : 56" />
                  </div>
                  <XenoPlantIcon v-else :id="lastRoll.resources[0].id" :size="56" />
                </div>
                <span v-else class="text-4xl opacity-40 select-none">🧬</span>
              </div>
            </div>

            <!-- Reveal -->
            <Transition enter-from-class="opacity-0 scale-90" enter-active-class="transition-all duration-300 ease-out">
              <div
                v-if="lastRoll && !reelSpinning"
                :key="`${lastRoll.typeId}-${recentRolls.length}`"
                class="mt-4 mx-auto max-w-sm rounded-2xl border p-4 xeno-reveal"
                :class="tierBg(rollTier(lastRoll))"
              >
                <p class="text-[10px] font-black uppercase tracking-[0.2em] mb-3" :class="lastRoll.isHybrid && lastRoll.resources.length >= 4 ? 'text-primary xeno-glow-text' : tierColor(rollTier(lastRoll))">
                  {{ !lastRoll.isHybrid ? 'Single plant' : lastRoll.resources.length === 4 ? '✨ Quad hybrid ✨' : `${lastRoll.resources.length}-resource hybrid` }}
                </p>
                <div class="space-y-1.5 xeno-stagger">
                  <div v-for="r in lastRoll.resources" :key="r.id" class="flex items-center gap-2 rounded-lg bg-background/50 border border-default/50 px-2.5 py-1.5">
                    <XenoPlantIcon :id="r.id" :size="22" />
                    <span class="text-sm font-semibold flex-1 text-left truncate" :class="tierNameColor(r.tier)">{{ r.name }}</span>
                    <XenoLevelBadge prefix="S" :level="r.speed" />
                    <XenoLevelBadge prefix="Y" :level="r.yield" />
                  </div>
                </div>
                <p v-if="lastRoll.isHybrid" class="text-[11px] text-muted mt-2.5">Vessel — one harvest yields all {{ lastRoll.resources.length }} plants and regrows itself.</p>
                <p v-else class="text-[11px] text-muted mt-2.5">Added to inventory.</p>
              </div>
            </Transition>

            <UButton class="mt-5" size="lg" color="primary" :class="!rolling && gems >= hybrids.costGems ? 'xeno-cta-pulse' : ''" :loading="rolling" :disabled="gems < hybrids.costGems" @click="doRollHybrid">
              <span class="flex items-center gap-2">
                <UIcon name="i-lucide-dices" class="size-5" />
                Roll — {{ formatNumber(hybrids.costGems, false) }} 💎
              </span>
            </UButton>
            <p v-if="gems < hybrids.costGems" class="text-xs text-error mt-2">Not enough gems (you have {{ formatNumber(gems, false) }} 💎)</p>
          </div>
        </div>

        <div v-if="hybrids.nextTierProgress" class="xeno-panel rounded-2xl p-4">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-bold uppercase tracking-wider text-muted">Discover all T{{ hybrids.nextTierProgress.tier }} plants → roll up to T{{ hybrids.nextTierProgress.tier }}</p>
            <span class="text-xs font-black tabular-nums">{{ hybrids.nextTierProgress.unlocked }}/{{ hybrids.nextTierProgress.total }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2.5">
            <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${(hybrids.nextTierProgress.unlocked / hybrids.nextTierProgress.total) * 100}%` }" />
          </div>
          <div v-if="hybrids.nextTierProgress.missing.length" class="flex flex-wrap items-center gap-1.5">
            <span class="text-[10px] text-muted uppercase tracking-wider font-semibold">Still need</span>
            <span v-for="m in hybrids.nextTierProgress.missing" :key="m.id" class="inline-flex items-center gap-1 text-xs rounded-md border border-default bg-background/50 px-1.5 py-0.5">
              <XenoPlantIcon :id="m.id" :size="14" class="xeno-silhouette" /><span class="text-muted">{{ m.name }}</span>
            </span>
          </div>
        </div>

        <div v-if="recentRolls.length">
          <p class="xeno-eyebrow mb-2">Recent rolls</p>
          <div class="flex flex-wrap gap-2">
            <div v-for="(roll, i) in recentRolls" :key="i" class="rounded-lg border border-default bg-elevated/50 px-2.5 py-1.5 flex items-center gap-1" :class="roll.isHybrid && roll.resources.length >= 4 ? 'ring-1 ring-primary/60 xeno-shimmer' : ''">
              <span v-if="roll.isHybrid" class="text-[10px] mr-0.5">🧬</span>
              <XenoPlantIcon v-for="r in roll.resources" :key="r.id" :id="r.id" :size="18" :title="`${r.name} · S${r.speed} Y${r.yield}`" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── GLOBAL UPGRADES TAB ── -->
    <div v-else class="space-y-3">
      <UAlert color="primary" variant="soft" icon="i-lucide-orbit" title="Account-wide cultivation upgrades" description="Permanent bonuses apply to every plot and pod. Speed reduces both grow and incubation time." />
      <div v-for="track in XENO_UPGRADE_TRACKS" :key="track.id" class="xeno-panel xeno-lift rounded-2xl p-4">
        <div class="flex items-center gap-4">
          <div class="xeno-orb size-12 shrink-0">
            <UIcon :name="track.icon" class="size-5 text-primary" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-3">
              <p class="font-bold">{{ track.name }}</p>
              <span class="text-xs font-black tabular-nums text-primary">LV {{ upgradeLevel(track.id) }} / {{ track.maxLevel }}</span>
            </div>
            <p class="text-xs text-muted mt-0.5">{{ track.description }}</p>
            <div class="flex items-center gap-1 mt-2">
              <span
                v-for="level in track.maxLevel" :key="level"
                class="h-1.5 flex-1 rounded-full transition-colors"
                :class="level <= upgradeLevel(track.id) ? 'bg-primary shadow-[0_0_6px_var(--ui-primary)]' : 'bg-muted/20'"
              />
            </div>
            <p class="text-xs font-semibold text-default mt-2">{{ track.effectLabel(upgradeLevel(track.id)) }}</p>
          </div>
          <div class="text-right shrink-0">
            <template v-if="xenoUpgradeCost(track.id, upgradeLevel(track.id)) !== null">
              <CoinBalance :value="xenoUpgradeCost(track.id, upgradeLevel(track.id))!" :compact="false" class="text-sm font-bold justify-end" />
              <UButton
                class="mt-2" size="sm" color="primary" label="Upgrade" icon="i-lucide-arrow-up"
                :loading="buyingUpgrade === track.id"
                :disabled="balance < xenoUpgradeCost(track.id, upgradeLevel(track.id))!"
                @click="(e: MouseEvent) => doBuyUpgrade(track.id, e)"
              />
            </template>
            <UBadge v-else color="success" variant="soft" label="MAX" />
          </div>
        </div>
      </div>
    </div>
  </UContainer>

  <!-- Confirm sell-all stack modal -->
  <UModal :open="!!confirmSell" title="Sell all of this stack?" @update:open="(v) => { if (!v) confirmSell = null }">
    <template #body>
      <div v-if="confirmSell" class="space-y-4">
        <p class="text-sm text-muted">
          You're about to sell all <span class="font-bold text-default">{{ confirmSell.item.quantity }}× {{ confirmSell.item.name }}</span>
          (S{{ confirmSell.item.speed }} Y{{ confirmSell.item.yield }}). This will leave you with <span class="font-bold text-error">0</span> of this stack.
        </p>
        <div class="flex items-center gap-1.5 text-sm font-semibold">
          <span>Total:</span>
          <CoinBalance :value="confirmSell.item.value * confirmSell.item.quantity" :compact="false" />
        </div>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" color="neutral" label="Cancel" @click="confirmSell = null" />
          <UButton color="error" label="Sell All" :loading="selling[`${stackKey(confirmSell.item)}-${confirmSell.item.quantity}`]" @click="doSell(confirmSell.item, confirmSell.item.quantity)" />
        </div>
      </div>
    </template>
  </UModal>

  <!-- Confirm sell-all keep N modal -->
  <UModal :open="confirmKeepSellAll" :title="`Sell surplus — keep ${keepAmount} per stack?`" @update:open="(v) => { if (!v) confirmKeepSellAll = false }">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Selling surplus from <span class="font-bold text-default">{{ keepSellableItems.length }} stack{{ keepSellableItems.length === 1 ? '' : 's' }}</span>,
          keeping up to <span class="font-bold text-default">{{ keepAmount }}</span> of each.
        </p>
        <div class="flex items-center gap-1.5 text-sm font-semibold">
          <span>You'll receive:</span>
          <CoinBalance :value="keepSellTotalValue" :compact="false" />
        </div>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" color="neutral" label="Cancel" @click="confirmKeepSellAll = false" />
          <UButton color="error" icon="i-lucide-trending-down" :label="`Sell — keep ${keepAmount}`" @click="doSellKeepAll" />
        </div>
      </div>
    </template>
  </UModal>

  <XenoHarvestFloat :items="fx.floats.value" />
  <XenoBurstLayer :particles="fx.particles.value" :flashes="fx.flashes.value" />
</template>
