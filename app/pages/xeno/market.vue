<script setup lang="ts">
import {
  getPlant, getPlantDisplay, effectiveGrowTime, plantBuyPrice, PLANT_TYPES,
  XENO_UPGRADE_TRACKS, xenoUpgradeCost, HYBRID_RARITY, type XenoUpgradeId
} from '#shared/utils/xeno'
import { formatDuration } from '~/lib/xeno-format'
import { roman, tierClass, formatPct } from '~/lib/xeno-ui'

const route = useRoute()
const router = useRouter()
const { user, balanceNum } = useAuth()
const gems = computed(() => Number(user.value?.gems ?? 0))

const { inventory, sellPlants, unlockedTypeIds, buyPlants, hybrids, rollHybrid, upgrades, buyUpgrade, fetchSession } = useXeno()
const sound = useXenoSound()
const fx = useXenoFx()

type Tab = 'sell' | 'buy' | 'upgrades' | 'grafting'
const TABS: { id: Tab, label: string }[] = [
  { id: 'sell', label: 'Sell' },
  { id: 'buy', label: 'Buy seeds' },
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'grafting', label: 'Grafting' }
]
// The ?tab= query is the only source of truth, so back/forward and links keep
// the tab bar and the pane in step.
const activeTab = computed<Tab>(() => {
  const q = String(route.query.tab ?? '')
  return TABS.some(t => t.id === q) ? q as Tab : 'sell'
})
const tabBar = ref<HTMLElement | null>(null)
function setTab(t: Tab) {
  if (activeTab.value === t) return
  sound.play('select')
  void router.replace({ query: { ...route.query, tab: t === 'sell' ? undefined : t } })
  // A shorter pane must never leave the tab bar scrolled out of reach.
  nextTick(() => {
    const el = tabBar.value
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'nearest' })
  })
}

// Clicks anchor the coin effects.
let lastClick: MouseEvent | null = null
function trackClick(e: MouseEvent) { lastClick = e }
function coinsAt(amount?: number) {
  const e = lastClick
  if (!e || (!e.clientX && !e.clientY)) return
  fx.burst(e.clientX, e.clientY, { count: 6, spread: 36, color: '#d9b25f' })
  if (amount != null) fx.float(e.clientX, e.clientY - 8, Math.round(amount), { emoji: '🪙' })
}

// ── Filters (shared by Sell and Buy) ─────────────────────────────────────────
const search = ref('')
const tierFilter = ref(0)
const sellSort = ref<'stack' | 'each' | 'qty' | 'tier' | 'name'>('stack')
const sellSortOptions = [
  { label: 'Stack value', value: 'stack' },
  { label: 'Price each', value: 'each' },
  { label: 'Quantity', value: 'qty' },
  { label: 'Tier', value: 'tier' },
  { label: 'Name', value: 'name' }
]
const tiersPresent = computed(() => {
  const src = activeTab.value === 'buy'
    ? PLANT_TYPES.filter(p => unlockedTypeIds.value.includes(p.id)).map(p => p.tier)
    : (inventory.value as any[]).map(i => i.tier as number)
  return [...new Set(src)].sort((a, b) => a - b)
})
const filterActive = computed(() => !!search.value.trim() || tierFilter.value !== 0)

function stackKey(item: any) {
  return `${item.typeId}:${item.speed}:${item.yield}`
}

const filteredInventory = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = (inventory.value as any[]).filter((item) => {
    if (tierFilter.value && item.tier !== tierFilter.value) return false
    if (q && !item.name.toLowerCase().includes(q) && !(item.resources ?? []).some((r: any) => r.name.toLowerCase().includes(q))) return false
    return true
  })
  const by = sellSort.value
  return list.sort((a, b) => {
    switch (by) {
      case 'each': return b.value - a.value
      case 'qty': return b.quantity - a.quantity
      case 'tier': return b.tier - a.tier || b.value * b.quantity - a.value * a.quantity
      case 'name': return a.name.localeCompare(b.name)
      default: return b.value * b.quantity - a.value * a.quantity
    }
  })
})
const shelfWorth = computed(() => (inventory.value as any[]).reduce((s, i) => s + i.value * i.quantity, 0))

// ── Keep N of every stack ────────────────────────────────────────────────────
// The field edits a plain ref and only writes through to the cookie. Binding it
// to the cookie directly lets each keystroke's cookie write echo back a moment
// later and overwrite what is being typed (10k turned into 1, 10, 10000).
const keepCookie = useCookie<number>('xeno_market_keep', { default: () => 20 })
const keepAmount = ref(Math.max(0, Math.floor(Number(keepCookie.value) || 0)))
watch(keepAmount, (v) => { keepCookie.value = v })
/** What the keep field means: a whole, non-negative count. */
const keep = computed(() => Math.max(0, Math.floor(Number(keepAmount.value) || 0)))
const keepText = useAmountInput(keepAmount, { integer: true })
function setKeep(n: number) {
  keepAmount.value = Math.max(0, Math.floor(n))
}
function keepSellQty(item: any): number {
  return item.isHybrid ? 0 : Math.max(0, item.quantity - keep.value)
}
const sweepItems = computed(() => filteredInventory.value.filter(i => keepSellQty(i) > 0))
const sweepQty = computed(() => sweepItems.value.reduce((s, i) => s + keepSellQty(i), 0))
const sweepValue = computed(() => sweepItems.value.reduce((s, i) => s + i.value * keepSellQty(i), 0))
const confirmSweep = ref(false)
const sweeping = ref(false)
watch(sweepQty, (n) => { if (!n) confirmSweep.value = false })
// Any change to what would be sold disarms the confirm.
watch([keep, sweepValue], () => { confirmSweep.value = false })

/** Sell several stacks at once; one session fetch settles the coins for the batch. */
async function sellBatch(items: { item: any, qty: number }[]) {
  const results = await Promise.allSettled(
    items.map(({ item, qty }) => sellPlants(item.typeId, item.speed, item.yield, qty, { settleBalance: false }))
  )
  await fetchSession()
  const total = results.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value?.total ?? 0) : 0), 0)
  const sold = results.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value?.sold ?? 0) : 0), 0)
  if (sold) {
    sound.play('harvest-big')
    coinsAt(total)
  }
  if (results.some(r => r.status === 'rejected')) sound.play('error')
}

async function doSweep() {
  if (sweeping.value || !sweepItems.value.length) return
  confirmSweep.value = false
  sweeping.value = true
  try {
    await sellBatch(sweepItems.value.map(item => ({ item, qty: keepSellQty(item) })))
  } finally {
    sweeping.value = false
  }
}

// ── Single sells ─────────────────────────────────────────────────────────────
const selling = ref<Record<string, boolean>>({})
const confirmSell = ref<{ item: any, qty: number } | null>(null)

function requestSell(item: any, qty: number) {
  if (qty >= item.quantity) confirmSell.value = { item, qty: item.quantity }
  else void doSell(item, qty)
}

async function doSell(item: any, qty: number, key = `${stackKey(item)}-${qty}`) {
  confirmSell.value = null
  selling.value[key] = true
  sound.play('coins')
  coinsAt(item.value * qty)
  try {
    await sellPlants(item.typeId, item.speed, item.yield, qty)
  } catch { sound.play('error') } finally { delete selling.value[key] }
}

function doSellKeep(item: any) {
  const qty = keepSellQty(item)
  if (qty > 0) void doSell(item, qty, `keep-${stackKey(item)}`)
}

// ── Bulk selection ───────────────────────────────────────────────────────────
const selected = ref(new Set<string>())
const sellableRows = computed(() => filteredInventory.value.filter(i => !i.isHybrid))
watch(inventory, () => {
  const keys = new Set((inventory.value as any[]).map(stackKey))
  for (const k of [...selected.value]) if (!keys.has(k)) selected.value.delete(k)
})
function toggleRow(item: any) {
  if (item.isHybrid) return
  const k = stackKey(item)
  if (selected.value.has(k)) selected.value.delete(k)
  else selected.value.add(k)
  confirmBulk.value = false
}
const allSelected = computed(() => sellableRows.value.length > 0 && sellableRows.value.every(i => selected.value.has(stackKey(i))))
function toggleAll() {
  if (allSelected.value) sellableRows.value.forEach(i => selected.value.delete(stackKey(i)))
  else sellableRows.value.forEach(i => selected.value.add(stackKey(i)))
  confirmBulk.value = false
}
// A selection only ever covers rows you can see: changing the filter clears it.
watch([search, tierFilter], () => {
  selected.value.clear()
  confirmBulk.value = false
})
const selectedItems = computed(() => (inventory.value as any[]).filter(i => !i.isHybrid && selected.value.has(stackKey(i))))
const selectedQty = computed(() => selectedItems.value.reduce((s, i) => s + i.quantity, 0))
const selectedValue = computed(() => selectedItems.value.reduce((s, i) => s + i.value * i.quantity, 0))
const confirmBulk = ref(false)
const bulkSelling = ref(false)
async function doSellSelected() {
  if (bulkSelling.value || !selectedItems.value.length) return
  confirmBulk.value = false
  bulkSelling.value = true
  const items = selectedItems.value.map(item => ({ item, qty: item.quantity }))
  selected.value.clear()
  try {
    await sellBatch(items)
  } finally {
    bulkSelling.value = false
  }
}

/** Each and Stack: small fractional amounts always show two decimals, so the columns line up. */
function formatEach(v: number): string {
  return formatNumber(v, true, v < 1000 && !Number.isInteger(v) ? 2 : 0)
}

function growTime(item: any) {
  const base = getPlantDisplay(item.typeId ?? item.id)
  if (!base) return '?'
  return formatDuration(item.isHybrid ? base.baseTime : effectiveGrowTime({ baseTime: base.baseTime, speed: item.speed }))
}

/** Why a coin button is disabled, or '' when it's affordable. */
function needCoins(cost: number): string {
  const short = cost - balanceNum.value
  return short > 0 ? `Need ${formatNumber(short)} more coins` : ''
}

// ── Buy ──────────────────────────────────────────────────────────────────────
const buying = ref<Record<string, boolean>>({})
const buyablePlants = computed(() => {
  const unlocked = new Set(unlockedTypeIds.value)
  const q = search.value.trim().toLowerCase()
  return PLANT_TYPES
    .filter(p => unlocked.has(p.id) && (!tierFilter.value || p.tier === tierFilter.value) && (!q || p.name.toLowerCase().includes(q)))
    .map(p => ({ ...p, buyPrice: plantBuyPrice(p) }))
    .sort((a, b) => b.tier !== a.tier ? b.tier - a.tier : b.value - a.value)
})
async function doBuy(typeId: string, qty: number, e: MouseEvent) {
  const key = `${typeId}-${qty}`
  buying.value[key] = true
  try {
    await buyPlants(typeId, qty)
    sound.play('buy')
    fx.burst(e.clientX, e.clientY, { count: 6, spread: 36, plantId: typeId })
  } catch { sound.play('error') } finally { delete buying.value[key] }
}

// ── Upgrades ─────────────────────────────────────────────────────────────────
const TRACK_STYLE: Record<XenoUpgradeId, { color: string, icon: string, next: (lv: number) => string }> = {
  mutation: { color: 'var(--xg-uv)', icon: 'i-lucide-sparkles', next: lv => `+${lv}% mutation chance in every pod` },
  yield: { color: 'var(--xg-t2)', icon: 'i-lucide-droplet', next: lv => `+${lv} plants on every planter harvest` },
  speed: { color: 'var(--xg-t3)', icon: 'i-lucide-zap', next: lv => `−${lv * 5}% grow and breed time` }
}
const buyingUpgrade = ref<string | null>(null)
async function doBuyUpgrade(id: XenoUpgradeId, e: MouseEvent) {
  buyingUpgrade.value = id
  try {
    await buyUpgrade(id)
    sound.play('unlock')
    fx.burst(e.clientX, e.clientY, { count: 8, spread: 44 })
  } catch { sound.play('error') } finally { buyingUpgrade.value = null }
}
function laterCosts(id: XenoUpgradeId, level: number): string {
  return [1, 2].map(n => xenoUpgradeCost(id, level + n)).filter((c): c is number => c != null).map(c => formatNumber(c)).join(' · ')
}

// ── Grafting (hybrid roll) ───────────────────────────────────────────────────
const rolling = ref(false)
const cycleIcons = ref<string[]>(['sprout', 'tendril', 'sprout', 'tendril'])
const lastRoll = ref<any>(null)
const recentRolls = ref<any[]>([])
const graftEl = ref<HTMLElement | null>(null)
const hybridPool = computed(() => PLANT_TYPES.filter(p => p.tier <= Math.max(1, hybrids.value.tier) && !p.voidPlant).map(p => p.id))

const rarityTotal = HYBRID_RARITY.reduce((s, r) => s + r.w, 0)
/** Chance that gene slot k (1-4) takes: the first always, then P(at least k genes). */
const geneOdds = [1, 2, 3, 4].map(k => HYBRID_RARITY.filter(r => r.k >= k).reduce((s, r) => s + r.w, 0) / rarityTotal)

async function doRollHybrid() {
  if (rolling.value || gems.value < hybrids.value.costGems) return
  rolling.value = true
  lastRoll.value = null
  // Cycle the graft slots while the request is out (cosmetic), and keep it
  // going a beat so the reveal never lands before the eye registers it.
  const pool = hybridPool.value
  const spin = setInterval(() => {
    cycleIcons.value = cycleIcons.value.map(() => pool[Math.floor(Math.random() * pool.length)] ?? 'sprout')
    sound.play('tick')
  }, 90)
  const minSpin = new Promise(r => setTimeout(r, 1000))
  try {
    const [res] = await Promise.all([rollHybrid(), minSpin]) as [any, unknown]
    clearInterval(spin)
    if (res?.result) {
      lastRoll.value = res.result
      recentRolls.value = [res.result, ...recentRolls.value].slice(0, 12)
      const quad = res.result.isHybrid && res.result.resources.length >= 4
      sound.play(quad ? 'mutation' : res.result.isHybrid ? 'roll-win' : 'collect')
      const c = fx.centerOf(graftEl.value)
      if (c) fx.burst(c.x, c.y, { count: quad ? 14 : 8, spread: quad ? 90 : 60, plantId: res.result.resources[0]?.id })
    }
  } catch {
    clearInterval(spin)
    sound.play('error')
  } finally {
    rolling.value = false
  }
}
const graftSlots = computed(() => [0, 1, 2, 3].map((i) => {
  if (rolling.value) return { id: cycleIcons.value[i], r: null }
  const r = lastRoll.value?.resources?.[i]
  return { id: r?.id ?? null, r: r ?? null }
}))
const nextProgress = computed(() => hybrids.value.nextTierProgress)

const tooltipUi = { content: 'h-auto p-0 bg-transparent ring-0 shadow-none' }
</script>

<template>
  <div class="mx-auto max-w-[1400px] px-4 md:px-6 pt-5 md:pt-6 flex flex-col gap-4" @click.capture="trackClick">
    <div>
      <p class="xg-label">Market</p>
      <h1 class="xg-h text-2xl md:text-3xl mt-1">Trade</h1>
    </div>

    <!-- Always rendered, outside every pane, so no tab can hide it. -->
    <nav ref="tabBar" class="flex gap-1 -mt-1 border-b border-(--xg-edge) overflow-x-auto [scrollbar-width:none] scroll-mt-4" aria-label="Market sections">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        class="xg-tab sub max-sm:!px-2.5"
        :class="activeTab === t.id ? 'on' : ''"
        :aria-current="activeTab === t.id ? 'page' : undefined"
        @click="setTab(t.id)"
      >
        {{ t.label }}
        <UIcon v-if="t.id === 'grafting' && !hybrids.unlocked" name="i-lucide-lock" class="size-3.5 text-(--xg-faint)" />
      </button>
    </nav>

    <!-- ═════════════ SELL ═════════════ -->
    <template v-if="activeTab === 'sell'">
      <section class="xg-pane p-4 md:p-5 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div class="flex-[1_1_280px] min-w-0">
          <p class="xg-label">Sell surplus</p>
          <p class="text-base font-extrabold mt-1">
            Keep <span class="xg-num text-(--xg-accent-text)">{{ formatNumber(keep, false) }}</span> of every {{ filterActive ? 'shown' : '' }} stack, sell the rest
          </p>
          <div class="flex flex-wrap items-center gap-1.5 mt-2.5">
            <UInput
              v-model="keepText"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0"
              size="md"
              class="w-40"
              :ui="{ base: 'rounded-full xg-num ps-[3.25rem]', leading: 'ps-3.5 pointer-events-none', trailing: 'pe-3 pointer-events-none' }"
              aria-label="Keep per stack (10k, 2.5m)"
            >
              <template #leading>
                <span class="text-xs font-bold text-(--xg-faint)">Keep</span>
              </template>
              <template v-if="amountPreview(keepText, true)" #trailing>
                <span class="text-[11px] text-(--xg-faint) xg-num">{{ amountPreview(keepText, true) }}</span>
              </template>
            </UInput>
            <button
              v-for="v in [0, 5, 20, 50]"
              :key="v"
              type="button"
              class="xg-filter"
              :class="keep === v ? 'on' : ''"
              :aria-label="`Keep ${v}`"
              @click="setKeep(v)"
            >{{ v }}</button>
          </div>
        </div>

        <div v-if="sweepItems.length" class="flex flex-wrap items-end gap-1 max-w-[400px]" aria-label="Plants that will be sold">
          <span v-for="item in sweepItems.slice(0, 8)" :key="stackKey(item)" class="flex flex-col items-center w-11" :title="`${item.name}: sell ${keepSellQty(item)}`">
            <XenoPlantIcon :id="item.typeId" :size="34" stage="ready" />
            <span class="xg-q text-[11px]">−{{ formatNumber(keepSellQty(item)) }}</span>
          </span>
          <span v-if="sweepItems.length > 8" class="text-xs font-bold text-(--xg-muted) pb-1">+{{ sweepItems.length - 8 }}</span>
        </div>

        <div class="flex flex-col items-start sm:items-end gap-1.5">
          <!-- Sell and its confirm share one cell, so the swap never moves anything. -->
          <div class="grid justify-items-start sm:justify-items-end">
            <XenoButton
              size="lg"
              class="[grid-area:1/1]"
              :class="confirmSweep ? 'invisible' : ''"
              :variant="sweepQty ? 'go' : 'default'"
              :disabled="!sweepQty"
              :loading="sweeping"
              @click="confirmSweep = true"
            >
              <span v-if="!sweeping" class="xg-coin" />Sell {{ formatNumber(sweepQty) }} · {{ formatNumber(sweepValue) }}
            </XenoButton>
            <div class="[grid-area:1/1] flex gap-1.5" :class="confirmSweep ? '' : 'invisible'">
              <XenoButton size="lg" class="!px-5" label="Cancel" @click="confirmSweep = false" />
              <XenoButton size="lg" class="!px-5" variant="go" :aria-label="`Confirm: sell ${sweepQty} plants`" @click="doSweep">
                <span class="xg-coin" />Confirm · {{ formatNumber(sweepValue) }}
              </XenoButton>
            </div>
          </div>
          <span class="text-[11.5px] text-(--xg-faint)">
            {{ sweepItems.length }} stack{{ sweepItems.length === 1 ? '' : 's' }} · hybrids are skipped · shelf worth {{ formatNumber(shelfWorth) }}
          </span>
        </div>
      </section>

      <section class="xg-pane xg-pane-r p-3 md:p-4 flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <UInput v-model="search" placeholder="Search plants" icon="i-lucide-search" size="lg" class="flex-[1_1_220px]" :ui="{ base: 'rounded-full' }" aria-label="Search plants" />
          <div v-if="tiersPresent.length > 1" class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tier">
            <button type="button" class="xg-filter" :class="tierFilter === 0 ? 'on' : ''" @click="tierFilter = 0">All</button>
            <button v-for="t in tiersPresent" :key="t" type="button" class="xg-filter" :class="tierFilter === t ? 'on' : ''" :aria-label="`Tier ${t}`" @click="tierFilter = tierFilter === t ? 0 : t">
              <span class="xg-tier" :class="tierClass(t)">{{ roman(t) }}</span>
            </button>
          </div>
          <USelect v-model="sellSort" :items="sellSortOptions" size="lg" class="w-40" :ui="{ base: 'rounded-full' }" aria-label="Sort by" />
        </div>

        <div v-if="!inventory.length" class="xg-well text-center py-12 px-4">
          <p class="text-sm font-extrabold">Nothing on the shelf</p>
          <p class="text-xs text-(--xg-muted) mt-1">Harvest a planter first.</p>
        </div>
        <div v-else-if="!filteredInventory.length" class="xg-well text-center text-sm text-(--xg-muted) py-12">No plants match your filter.</div>

        <!-- Bulk bar: always there (a hint until something is selected), so picking rows never moves the table. -->
        <div
          v-if="filteredInventory.length"
          class="flex items-center gap-2 sm:gap-3 min-h-[52px] pl-2.5 pr-2 py-1.5 rounded-[14px_14px_14px_4px] border transition-colors"
          :class="selectedItems.length ? 'border-(--xg-accent-edge) bg-(--xg-accent-soft)' : 'border-(--xg-edge) bg-(--xg-well)'"
        >
          <button
            type="button"
            class="xg-check"
            :class="allSelected ? 'on' : selected.size ? 'some' : ''"
            :disabled="!sellableRows.length"
            :aria-label="allSelected ? 'Clear selection' : 'Select all shown'"
            @click="toggleAll"
          >
            <UIcon :name="allSelected ? 'i-lucide-check' : 'i-lucide-minus'" class="size-3.5" />
          </button>
          <span class="text-[13px] min-w-0 flex-1 truncate">
            <template v-if="selectedItems.length">
              <b>{{ selectedItems.length }} stack{{ selectedItems.length === 1 ? '' : 's' }}</b>
              <span class="hidden sm:inline text-(--xg-muted)"> · {{ formatNumber(selectedQty) }} plants</span>
              <span class="text-(--xg-muted)"> · </span>
              <b class="xg-num">{{ formatNumber(selectedValue) }}</b>
            </template>
            <span v-else class="text-(--xg-muted)">Select stacks to sell them together</span>
          </span>
          <template v-if="selectedItems.length">
            <XenoButton size="sm" class="shrink-0" label="Clear" @click="selected.clear(); confirmBulk = false" />
            <XenoButton v-if="!confirmBulk" size="sm" class="shrink-0" variant="go" :loading="bulkSelling" @click="confirmBulk = true">
              <span class="xg-coin" /><span class="sm:hidden">Sell</span><span class="max-sm:hidden">Sell selected</span>
            </XenoButton>
            <XenoButton v-else size="sm" class="shrink-0" variant="go" :aria-label="`Confirm: sell all ${selectedQty} plants`" @click="doSellSelected">
              <span class="xg-coin" />Confirm<span class="max-sm:hidden"> · all {{ formatNumber(selectedQty) }}</span>
            </XenoButton>
          </template>
        </div>

        <div v-if="filteredInventory.length" role="table" aria-label="Plants on the shelf">
          <div role="row" class="hidden md:grid grid-cols-[28px_minmax(0,2.2fr)_1.2fr_.6fr_.8fr_.9fr_250px] items-center gap-3 px-2.5 py-1 xg-label">
            <span role="columnheader"><span class="sr-only">Select</span></span>
            <span role="columnheader">Plant</span>
            <span role="columnheader">Stats</span>
            <span role="columnheader" class="text-right">Qty</span>
            <span role="columnheader" class="text-right">Each</span>
            <span role="columnheader" class="text-right">Stack</span>
            <span role="columnheader" class="text-right">Quick sell</span>
          </div>
          <div
            v-for="item in filteredInventory"
            :key="stackKey(item)"
            role="row"
            class="grid grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[28px_minmax(0,2.2fr)_1.2fr_.6fr_.8fr_.9fr_250px] items-center gap-x-3 gap-y-2 px-2.5 py-2 rounded-[16px_16px_16px_4px] border transition-colors"
            :class="selected.has(stackKey(item)) ? 'border-(--xg-accent-edge) bg-(--xg-accent-soft)' : 'border-transparent hover:bg-(--xg-hover) hover:border-(--xg-edge)'"
          >
            <span role="cell">
              <button
                v-if="!item.isHybrid"
                type="button"
                class="xg-check"
                :class="selected.has(stackKey(item)) ? 'on' : ''"
                :aria-label="`Select ${item.name} S${item.speed} Y${item.yield}`"
                :aria-pressed="selected.has(stackKey(item))"
                @click="toggleRow(item)"
              >
                <UIcon name="i-lucide-check" class="size-3.5" />
              </button>
            </span>
            <UTooltip :delay-duration="350" :content="{ side: 'bottom', align: 'start', sideOffset: 6 }" :ui="tooltipUi">
              <template #content>
                <XenoPlantTooltipContent
                  :id="item.typeId" :name="item.name" :tier="item.tier" :speed="item.speed" :yield="item.yield"
                  :base-time="item.baseTime" :value="item.value" :description="item.description" :quantity="item.quantity"
                  :is-hybrid="item.isHybrid" :resources="item.resources"
                />
              </template>
              <span role="cell" class="flex items-center gap-2.5 min-w-0 cursor-default">
                <span class="xg-thumb size-10"><XenoPlantIcon :id="item.typeId" :size="34" stage="ready" /></span>
                <span class="min-w-0">
                  <span class="flex items-center gap-1.5">
                    <b class="text-[13.5px] truncate">{{ item.isHybrid ? 'Hybrid' : item.name }}</b>
                    <XenoTierLabel :tier="item.tier" :is-void="!!getPlant(item.typeId)?.voidPlant" />
                  </span>
                  <span class="md:hidden xg-stats block">
                    <template v-if="item.isHybrid">{{ item.resources.map((r: any) => r.name).join(' · ') }}</template>
                    <template v-else>S<b>{{ item.speed }}</b> Y<b>{{ item.yield }}</b> · ×<b>{{ formatNumber(item.quantity) }}</b> · {{ formatNumber(item.value * item.quantity) }}</template>
                  </span>
                </span>
              </span>
            </UTooltip>
            <span role="cell" class="hidden md:block xg-stats truncate">
              <template v-if="item.isHybrid">{{ item.resources.length }} genes · {{ growTime(item) }}</template>
              <template v-else>Speed <b>{{ item.speed }}</b> · Yield <b>{{ item.yield }}</b> · {{ growTime(item) }}</template>
            </span>
            <span role="cell" class="hidden md:block xg-q text-right">{{ formatNumber(item.quantity) }}</span>
            <span role="cell" class="hidden md:block xg-num text-right text-(--xg-muted)">{{ item.isHybrid ? '—' : formatEach(item.value) }}</span>
            <span role="cell" class="hidden md:block xg-num text-right font-bold">{{ item.isHybrid ? '—' : formatEach(item.value * item.quantity) }}</span>
            <span role="cell" class="col-span-3 md:col-span-1 flex justify-end gap-1 max-md:pl-[40px]">
              <template v-if="!item.isHybrid">
                <XenoButton
                  v-for="qty in [1, 10, 50].filter(q => q < item.quantity)"
                  :key="qty"
                  size="xs"
                  class="!px-2.5"
                  :loading="selling[`${stackKey(item)}-${qty}`]"
                  :label="`×${qty}`"
                  :title="`Sell ${qty}`"
                  @click="requestSell(item, qty)"
                />
                <XenoButton
                  size="xs"
                  class="!px-2.5"
                  :loading="selling[`${stackKey(item)}-${item.quantity}`]"
                  label="All"
                  :title="`Sell the whole stack (${formatNumber(item.quantity, false)})`"
                  @click="requestSell(item, item.quantity)"
                />
                <XenoButton
                  size="xs"
                  :variant="keepSellQty(item) ? 'go' : 'default'"
                  :disabled="!keepSellQty(item)"
                  :loading="selling[`keep-${stackKey(item)}`]"
                  :label="keepSellQty(item) ? `Above ${formatNumber(keep)}` : 'At keep'"
                  :title="keepSellQty(item) ? `Sell ${keepSellQty(item)}, keep ${formatNumber(keep, false)}` : `You have ${formatNumber(keep, false)} or fewer`"
                  @click="doSellKeep(item)"
                />
              </template>
              <span v-else class="text-xs text-(--xg-faint)">Hybrids can't be sold</span>
            </span>
          </div>
        </div>
      </section>

    </template>

    <!-- ═════════════ BUY ═════════════ -->
    <template v-else-if="activeTab === 'buy'">
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="search" placeholder="Search seeds" icon="i-lucide-search" size="lg" class="flex-[1_1_220px] max-w-md" :ui="{ base: 'rounded-full' }" aria-label="Search seeds" />
        <div v-if="tiersPresent.length > 1" class="flex flex-wrap gap-1.5">
          <button type="button" class="xg-filter" :class="tierFilter === 0 ? 'on' : ''" @click="tierFilter = 0">All</button>
          <button v-for="t in tiersPresent" :key="t" type="button" class="xg-filter" :class="tierFilter === t ? 'on' : ''" :aria-label="`Tier ${t}`" @click="tierFilter = tierFilter === t ? 0 : t">
            <span class="xg-tier" :class="tierClass(t)">{{ roman(t) }}</span>
          </button>
        </div>
      </div>
      <p class="text-[13px] text-(--xg-muted)">Seeds of every species you have discovered, at their base speed and yield.</p>

      <div v-if="!unlockedTypeIds.length" class="xg-well text-center text-sm text-(--xg-muted) py-12">Harvest plants in the garden to unlock their seeds here.</div>
      <div v-else-if="!buyablePlants.length" class="xg-well text-center text-sm text-(--xg-muted) py-12">No discovered species match your filter.</div>
      <section v-else class="grid gap-3.5 grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))]">
        <article v-for="plant in buyablePlants" :key="plant.id" class="xg-pane p-3.5 flex flex-col gap-3">
          <div class="flex gap-3 items-center">
            <span class="xg-thumb size-16"><XenoPlantIcon :id="plant.id" :size="56" stage="ready" /></span>
            <div class="min-w-0">
              <p class="flex items-center gap-1.5"><b class="text-[14.5px] truncate">{{ plant.name }}</b><XenoTierLabel :tier="plant.tier" :is-void="!!plant.voidPlant" /></p>
              <p class="xg-stats mt-0.5">Speed <b>{{ plant.speed }}</b> · Yield <b>{{ plant.yield }}</b></p>
              <p class="text-[11.5px] text-(--xg-faint)">Grows in {{ formatDuration(effectiveGrowTime(plant)) }}{{ plant.voidPlant ? ' · void' : '' }}</p>
            </div>
          </div>
          <div class="flex gap-1.5">
            <XenoButton
              size="sm"
              class="flex-1"
              :disabled="balanceNum < plant.buyPrice"
              :loading="buying[`${plant.id}-1`]"
              :title="needCoins(plant.buyPrice) || `${formatNumber(plant.buyPrice, false)} coins`"
              :aria-label="`Buy 1 ${plant.name} for ${formatNumber(plant.buyPrice, false)} coins`"
              @click="(e: MouseEvent) => doBuy(plant.id, 1, e)"
            >
              <span class="xg-coin" />{{ formatNumber(plant.buyPrice) }}
            </XenoButton>
            <XenoButton
              v-for="qty in [10, 100]"
              :key="qty"
              size="sm"
              :disabled="balanceNum < plant.buyPrice * qty"
              :loading="buying[`${plant.id}-${qty}`]"
              :title="needCoins(plant.buyPrice * qty) || `${formatNumber(plant.buyPrice * qty, false)} coins`"
              :aria-label="`Buy ${qty} ${plant.name} for ${formatNumber(plant.buyPrice * qty, false)} coins`"
              :label="`×${qty}`"
              @click="(e: MouseEvent) => doBuy(plant.id, qty, e)"
            />
          </div>
          <p v-if="balanceNum < plant.buyPrice" class="text-[11.5px] text-(--xg-muted) -mt-1.5">{{ needCoins(plant.buyPrice) }}</p>
        </article>
      </section>
    </template>

    <!-- ═════════════ UPGRADES ═════════════ -->
    <template v-else-if="activeTab === 'upgrades'">
      <p class="text-[13px] text-(--xg-muted)">Permanent and account-wide. Each card says what the next level changes on your farm.</p>
      <section class="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <article
          v-for="track in XENO_UPGRADE_TRACKS"
          :key="track.id"
          class="xg-pane p-4 md:p-5 flex flex-col gap-3"
        >
          <div class="flex items-center gap-3">
            <span class="xg-glyph size-12" :style="{ '--gc': TRACK_STYLE[track.id].color }">
              <UIcon :name="TRACK_STYLE[track.id].icon" class="size-5" />
            </span>
            <div class="min-w-0 flex-1">
              <b class="xg-h text-[16px] block">{{ track.name }}</b>
              <span class="xg-num text-[12.5px] text-(--xg-muted)">Level <b class="text-(--xg-ink)">{{ upgrades[track.id] }}</b> of {{ track.maxLevel }}</span>
            </div>
          </div>
          <div class="xg-steps" :style="{ '--sc': TRACK_STYLE[track.id].color }" role="img" :aria-label="`Level ${upgrades[track.id]} of ${track.maxLevel}`">
            <span v-for="n in track.maxLevel" :key="n" :class="n <= upgrades[track.id] ? 'on' : ''" />
          </div>
          <div>
            <p class="text-[13.5px]">
              <span class="text-(--xg-muted)">{{ upgrades[track.id] ? track.effectLabel(upgrades[track.id]) : 'Not researched' }}</span>
              <template v-if="upgrades[track.id] < track.maxLevel">
                <span class="text-(--xg-faint)"> → </span>
                <b>{{ TRACK_STYLE[track.id].next(upgrades[track.id] + 1) }}</b>
              </template>
            </p>
            <p class="text-[12.5px] text-(--xg-faint) mt-0.5">{{ track.description }}</p>
          </div>
          <div class="mt-auto pt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <template v-if="xenoUpgradeCost(track.id, upgrades[track.id]) !== null">
              <XenoButton
                variant="sun"
                size="sm"
                :loading="buyingUpgrade === track.id"
                :disabled="balanceNum < xenoUpgradeCost(track.id, upgrades[track.id])!"
                :title="`${formatNumber(xenoUpgradeCost(track.id, upgrades[track.id])!, false)} coins`"
                @click="(e: MouseEvent) => doBuyUpgrade(track.id, e)"
              >
                <span class="xg-coin" />{{ formatNumber(xenoUpgradeCost(track.id, upgrades[track.id])!) }}
              </XenoButton>
              <span class="flex flex-col text-[11.5px] leading-snug">
                <span v-if="balanceNum < xenoUpgradeCost(track.id, upgrades[track.id])!" class="text-(--xg-muted)">{{ needCoins(xenoUpgradeCost(track.id, upgrades[track.id])!) }}</span>
                <span v-if="laterCosts(track.id, upgrades[track.id])" class="text-(--xg-faint)">then {{ laterCosts(track.id, upgrades[track.id]) }}</span>
              </span>
            </template>
            <span v-else class="xg-chip go">Maxed</span>
          </div>
        </article>
      </section>
    </template>

    <!-- ═════════════ GRAFTING ═════════════ -->
    <template v-else>
      <section class="grid gap-4 items-stretch lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <!-- Left: what grafting is, the four gene slots and the last result -->
        <div class="xg-pane p-4 md:p-5 flex flex-col gap-4">
          <div>
            <h2 class="xg-h text-xl">Grafting</h2>
            <p v-if="hybrids.unlocked" class="text-[13px] text-(--xg-muted) mt-1">
              Graft up to four plants onto one rootstock. Your graft tier is <b class="text-(--xg-ink)">{{ roman(hybrids.tier) }}</b>:
              genes from any non-void plant up to tier {{ roman(hybrids.tier) }}, each with its own speed and yield from 0 to {{ hybrids.tier }}.
              A hybrid harvests all its genes at once and regrows itself, but it can't be sold or bred.
            </p>
            <p v-else class="text-[13px] text-(--xg-muted) mt-1">
              Discover <b class="text-(--xg-ink)">every tier {{ roman(hybrids.unlockTier) }} plant</b> to start grafting: one hybrid that harvests up to four different plants at once.
            </p>
          </div>

          <div ref="graftEl" class="grid grid-cols-4 gap-2 sm:gap-3">
            <div v-for="(g, i) in graftSlots" :key="i" class="flex flex-col items-center gap-1 min-w-0">
              <div
                class="xg-bed w-full max-w-[112px] aspect-square !rounded-[18px_18px_18px_6px]"
                :class="g.id ? '' : '!border-dashed !bg-transparent'"
              >
                <XenoPlantIcon v-if="g.id" :id="g.id" size="80%" stage="ready" :class="rolling ? 'xg-cycle' : 'xg-pop'" :style="!rolling ? { animationDelay: `${i * 120}ms` } : undefined" />
                <UIcon v-else :name="hybrids.unlocked ? 'i-lucide-dna' : 'i-lucide-lock'" class="size-5 text-(--xg-faint)" />
              </div>
              <b class="text-[12.5px] truncate max-w-full">{{ g.r ? g.r.name : `Gene ${i + 1}` }}</b>
              <span class="xg-stats !text-[11.5px]">{{ g.r ? `S${g.r.speed} · Y${g.r.yield}` : (i === 0 ? 'always' : formatPct(geneOdds[i]!)) }}</span>
            </div>
          </div>

          <div v-if="lastRoll && !rolling" class="xg-well p-3 flex gap-3 items-center xg-fade mt-auto">
            <span class="xg-thumb size-14"><XenoPlantIcon :id="lastRoll.typeId ?? lastRoll.resources[0]?.id" :size="48" stage="ready" /></span>
            <div class="min-w-0">
              <p class="xg-label !text-(--xg-sky)">
                {{ !lastRoll.isHybrid ? 'Result · a normal seed' : `Result · ${lastRoll.resources.length}-gene hybrid` }}
              </p>
              <p class="text-[14px] font-extrabold mt-0.5">{{ lastRoll.resources.map((r: any) => r.name).join(' · ') }}</p>
              <p class="text-xs text-(--xg-faint) mt-0.5">
                {{ lastRoll.isHybrid ? 'Added to your shelf. Every gene harvests at its own speed and yield; it grows as fast as its slowest gene.' : 'Added to your shelf.' }}
              </p>
            </div>
          </div>
          <p v-else-if="hybrids.unlocked" class="xg-well px-3 py-2.5 text-xs text-(--xg-muted) mt-auto">
            Each graft rolls its genes at random; the first always takes. The result goes straight to your shelf.
          </p>
        </div>

        <!-- Right: odds, the graft button, tier progress and recent grafts -->
        <div class="xg-pane xg-pane-r p-4 md:p-5 flex flex-col gap-4">
          <div>
            <p class="xg-label mb-2">Gene count odds</p>
            <div class="xg-odds" role="img" aria-label="Gene count odds">
              <i v-for="(r, i) in HYBRID_RARITY" :key="r.k" :style="{ width: `${(r.w / rarityTotal) * 100}%`, background: ['var(--xg-edge2)', 'color-mix(in srgb, var(--xg-sky) 50%, transparent)', 'var(--xg-sky)', 'var(--xg-ink)'][i] }" />
            </div>
            <div class="flex flex-wrap justify-between gap-x-3 mt-1.5 text-xs text-(--xg-faint)">
              <span v-for="r in HYBRID_RARITY" :key="r.k">{{ r.k }} gene{{ r.k === 1 ? ' (a normal seed)' : 's' }} {{ formatPct(r.w / rarityTotal) }}</span>
            </div>
          </div>

          <div v-if="hybrids.unlocked" class="flex flex-wrap items-center gap-3">
            <XenoButton variant="sky" :loading="rolling" :disabled="gems < hybrids.costGems" @click="doRollHybrid">
              <span v-if="!rolling" class="xg-gem" />Graft · {{ formatNumber(hybrids.costGems, false) }} gem{{ hybrids.costGems === 1 ? '' : 's' }}
            </XenoButton>
            <span v-if="gems < hybrids.costGems" class="text-xs font-bold text-(--xg-rose)">You have {{ formatNumber(gems, false) }} gems</span>
          </div>

          <template v-if="nextProgress">
            <div class="xg-rule" />
            <div>
              <div class="flex justify-between gap-3 text-[13px]">
                <b>{{ hybrids.unlocked ? `Discover every tier ${roman(nextProgress.tier)} plant to graft tier ${roman(nextProgress.tier)} genes` : `Discover every tier ${roman(nextProgress.tier)} plant` }}</b>
                <b class="xg-num shrink-0">{{ nextProgress.unlocked }}/{{ nextProgress.total }}</b>
              </div>
              <div class="xg-meter mt-2"><span :style="{ width: `${(nextProgress.unlocked / nextProgress.total) * 100}%`, background: 'var(--xg-sky)' }" /></div>
              <div v-if="nextProgress.missing.length" class="mt-3">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs font-bold text-(--xg-muted)">Still hidden</span>
                  <NuxtLink to="/xeno/encyclopedia" class="xg-link text-[12.5px] whitespace-nowrap">Find recipes</NuxtLink>
                </div>
                <div class="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-x-3 gap-y-1.5 mt-1.5">
                  <span v-for="m in nextProgress.missing" :key="m.id" class="flex items-center gap-1.5 min-w-0 text-[12.5px] font-bold" :title="m.name">
                    <XenoPlantIcon :id="m.id" :size="24" stage="ready" silhouette class="shrink-0" /><span class="truncate">{{ m.name }}</span>
                  </span>
                </div>
              </div>
            </div>
          </template>

          <template v-if="recentRolls.length">
            <div class="xg-rule" />
            <div>
              <p class="xg-label mb-2">Recent grafts</p>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(roll, i) in recentRolls"
                  :key="i"
                  class="inline-flex items-center gap-0.5 rounded-xl border px-2 py-1"
                  :class="roll.isHybrid && roll.resources.length >= 4 ? 'border-(--xg-sky)' : 'border-(--xg-edge)'"
                  :title="roll.resources.map((r: any) => `${r.name} S${r.speed} Y${r.yield}`).join(', ')"
                >
                  <XenoPlantIcon v-for="r in roll.resources" :key="r.id" :id="r.id" :size="20" stage="ready" />
                </span>
              </div>
            </div>
          </template>
        </div>
      </section>
    </template>
  </div>

  <!-- Confirm selling a whole stack -->
  <UModal
    :open="!!confirmSell"
    title="Sell the whole stack?"
    :ui="{ content: 'xeno bg-(--xg-surface) rounded-[20px_20px_20px_6px]', header: 'border-(--xg-edge)', body: 'text-(--xg-ink)' }"
    @update:open="(v) => { if (!v) confirmSell = null }"
  >
    <template #body>
      <div v-if="confirmSell" class="space-y-4">
        <div class="flex items-center gap-3">
          <span class="xg-thumb size-12"><XenoPlantIcon :id="confirmSell.item.typeId" :size="42" stage="ready" /></span>
          <p class="text-sm text-(--xg-muted)">
            All <b class="text-(--xg-ink)">{{ formatNumber(confirmSell.item.quantity, false) }} {{ confirmSell.item.name }}</b>
            (speed {{ confirmSell.item.speed }}, yield {{ confirmSell.item.yield }}). None of this stack will be left.
          </p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <XenoButton size="sm" label="Cancel" @click="confirmSell = null" />
          <XenoButton size="sm" variant="go" @click="doSell(confirmSell.item, confirmSell.item.quantity)">
            <span class="xg-coin" />Sell all · {{ formatNumber(confirmSell.item.value * confirmSell.item.quantity) }}
          </XenoButton>
        </div>
      </div>
    </template>
  </UModal>

  <XenoHarvestFloat :items="fx.floats.value" />
  <XenoBurstLayer :particles="fx.particles.value" />
</template>
