<script setup lang="ts">
import { tierNameColor, tierBg, getPlantDisplay, effectiveGrowTime, plantBuyPrice, PLANT_TYPES } from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

const { inventory, sellPlants, unlockedTypeIds, buyPlants, hybrids, rollHybrid } = useXeno()

const activeTab = ref<'sell' | 'buy' | 'hybrids'>('sell')

// ── Hybrid gamble state ──────────────────────────────────────────────────────
const rolling = ref(false)
const lastRoll = ref<any>(null)
const recentRolls = ref<any[]>([])

async function doRollHybrid() {
  if (rolling.value || gems.value < hybrids.value.costGems) return
  rolling.value = true
  try {
    const res: any = await rollHybrid()
    if (res?.result) {
      lastRoll.value = res.result
      recentRolls.value = [res.result, ...recentRolls.value].slice(0, 12)
    }
  } finally {
    rolling.value = false
  }
}
const searchQuery = ref('')
const tierFilter = ref(0)

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
  return Math.max(0, item.quantity - keepAmount.value)
}

const keepSellableItems = computed(() =>
  filteredInventory.value.filter((item: any) => keepSellQty(item) > 0),
)

const keepSellTotalValue = computed(() =>
  keepSellableItems.value.reduce((sum: number, item: any) => sum + item.value * keepSellQty(item), 0),
)

function buyPrice(plant: { value: number; yield: number; speed: number }): number {
  return plantBuyPrice(plant)
}

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
    .map(p => ({ ...p, buyPrice: buyPrice(p) }))
    .sort((a, b) => b.tier !== a.tier ? b.tier - a.tier : b.value - a.value)
})

const totalInventoryValue = computed(() =>
  (inventory.value || []).reduce((sum: number, item: any) => sum + item.value * item.quantity, 0),
)

const selling = ref<Record<string, boolean>>({})
const buying = ref<Record<string, boolean>>({})
const sellingKeepAll = ref(false)

const confirmSell = ref<{ item: any; qty: number } | null>(null)
const confirmKeepSellAll = ref(false)

function stackKey(item: any) {
  return `${item.typeId}:${item.speed}:${item.yield}`
}

function requestSell(item: any, qty: number) {
  if (qty >= item.quantity) {
    confirmSell.value = { item, qty }
  } else {
    doSell(item, qty)
  }
}

async function doSell(item: any, qty: number) {
  confirmSell.value = null
  const key = `${stackKey(item)}-${qty}`
  selling.value[key] = true
  try { await sellPlants(item.typeId, item.speed, item.yield, qty) }
  finally { delete selling.value[key] }
}

async function doSellKeep(item: any) {
  const qty = keepSellQty(item)
  if (qty <= 0) return
  const key = `keep-${stackKey(item)}`
  selling.value[key] = true
  try { await sellPlants(item.typeId, item.speed, item.yield, qty) }
  finally { delete selling.value[key] }
}

async function doSellKeepAll() {
  confirmKeepSellAll.value = false
  sellingKeepAll.value = true
  try {
    await Promise.all(
      keepSellableItems.value.map((item: any) =>
        sellPlants(item.typeId, item.speed, item.yield, keepSellQty(item)),
      ),
    )
  } finally {
    sellingKeepAll.value = false
  }
}

async function doBuy(typeId: string, qty: number) {
  const key = `${typeId}-${qty}`
  buying.value[key] = true
  try { await buyPlants(typeId, qty) }
  finally { delete buying.value[key] }
}

function growTime(item: any) {
  const base = getPlantDisplay(item.typeId ?? item.id)
  return base ? formatDuration(effectiveGrowTime({ baseTime: base.baseTime, speed: item.speed })) : '?'
}

function resourceEmojis(item: any): string[] {
  return (item.resources ?? []).map((r: any) => r.emoji ?? '❓')
}
</script>

<template>
  <UContainer class="pt-6">
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold flex items-center gap-2"><span>🏪</span> Market</h1>
        <p class="text-sm text-muted mt-0.5">Buy and sell xenoflora.</p>
      </div>
      <div class="text-right shrink-0">
        <p class="text-xs text-muted uppercase tracking-wider font-semibold">Portfolio value</p>
        <CoinBalance :value="totalInventoryValue" :compact="false" class="text-lg font-black" />
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex border-b border-default mb-4">
      <button
        class="px-5 py-2.5 text-sm font-semibold transition-all duration-100"
        :class="activeTab === 'sell' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
        @click="activeTab = 'sell'"
      >
        Sell
      </button>
      <button
        class="px-5 py-2.5 text-sm font-semibold transition-all duration-100"
        :class="activeTab === 'buy' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
        @click="activeTab = 'buy'"
      >
        Buy
      </button>
      <button
        class="px-5 py-2.5 text-sm font-semibold transition-all duration-100 flex items-center gap-1.5"
        :class="activeTab === 'hybrids' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
        @click="activeTab = 'hybrids'"
      >
        <span>🧬</span> Hybrids
        <UIcon v-if="!hybrids.unlocked" name="i-lucide-lock" class="size-3" />
      </button>
    </div>

    <!-- Filters -->
    <div v-if="activeTab !== 'hybrids'" class="flex gap-2 mb-4">
      <UInput
        v-model="searchQuery"
        placeholder="Search plants…"
        icon="i-lucide-search"
        size="sm"
        class="flex-1"
      />
      <USelect
        v-model="tierFilter"
        :items="[
          { label: 'All tiers', value: 0 },
          { label: 'T1', value: 1 },
          { label: 'T2', value: 2 },
          { label: 'T3', value: 3 },
          { label: 'T4', value: 4 },
          { label: 'T5', value: 5 },
          { label: 'T6', value: 6 },
          { label: 'T7', value: 7 },
        ]"
        size="sm"
        class="w-28"
      />
    </div>

    <!-- ── SELL TAB ── -->
    <div v-if="activeTab === 'sell'">

      <!-- Sell settings bar -->
      <div class="flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl border border-default bg-elevated/50">
        <UIcon name="i-lucide-settings-2" class="size-3.5 text-muted shrink-0" />
        <span class="text-xs text-muted font-medium shrink-0">Keep per stack</span>
        <UInput
          v-model="keepInput"
          type="number"
          min="0"
          size="xs"
          class="w-20"
        />
        <div class="flex-1" />
        <div v-if="keepSellTotalValue > 0" class="flex items-center gap-1 text-xs text-muted shrink-0">
          <CoinBalance :value="keepSellTotalValue" :compact="false" />
        </div>
        <UButton
          size="xs"
          color="error"
          variant="soft"
          icon="i-lucide-trending-down"
          :label="`Sell All — keep ${keepAmount}`"
          :disabled="keepSellableItems.length === 0 || sellingKeepAll"
          :loading="sellingKeepAll"
          @click="confirmKeepSellAll = true"
        />
      </div>

      <div v-if="!inventory" class="space-y-2">
        <USkeleton v-for="i in 4" :key="i" class="h-20 rounded-xl" />
      </div>

      <div v-else class="space-y-2">
        <div v-if="!filteredInventory.length" class="text-sm text-muted py-12 text-center">
          {{ inventory.length ? 'No plants match your filter.' : 'No plants in inventory.' }}
        </div>

        <div
          v-for="item in filteredInventory"
          :key="stackKey(item)"
          class="rounded-xl border border-default px-4 py-3 flex items-center gap-4 transition-colors hover:border-primary/60 hover:bg-primary/5"
          :class="tierBg(item.tier)"
        >
          <!-- Emoji + qty -->
          <div class="shrink-0 flex items-center gap-2">
            <UTooltip :delay-duration="300" :content="{ side: 'right', sideOffset: 8 }">
              <template #content>
                <XenoPlantTooltipContent
                  :name="item.name"
                  :tier="item.tier"
                  :color="item.color"
                  :speed="item.speed"
                  :yield="item.yield"
                  :base-time="item.baseTime"
                  :value="item.value"
                  :description="item.description"
                  :quantity="item.quantity"
                  :is-hybrid="item.isHybrid"
                  :resources="item.resources"
                />
              </template>
              <span class="text-2xl leading-none cursor-default">{{ item.emoji }}</span>
            </UTooltip>
            <span class="text-sm font-black text-primary tabular-nums leading-none">×{{ item.quantity }}</span>
          </div>

          <!-- Plant info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <p class="font-bold text-sm" :class="tierNameColor(item.tier)">{{ item.name }}</p>
              <span
                v-if="item.isHybrid"
                class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 leading-none shrink-0"
              >Hybrid</span>
              <XenoTierLabel :tier="item.tier" />
              <span v-if="item.isHybrid" class="flex items-center gap-0.5 text-sm">
                <span v-for="(e, i) in resourceEmojis(item)" :key="i" class="leading-none">{{ e }}</span>
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

          <!-- Total + price per unit -->
          <div class="text-right shrink-0 hidden sm:flex flex-col items-end gap-0.5">
            <template v-if="item.isHybrid">
              <p class="text-xs text-muted italic">vessel</p>
              <p class="text-[10px] text-muted/60">no sell value</p>
            </template>
            <template v-else>
              <p class="text-sm font-bold tabular-nums flex items-center gap-1"><CoinBalance :value="item.value * item.quantity" :compact="false" /></p>
              <p class="text-xs text-muted tabular-nums flex items-center gap-1"><CoinBalance :value="item.value" :compact="false" /> ea</p>
            </template>
          </div>

          <!-- Sell buttons -->
          <div class="flex gap-1 shrink-0">
            <UButton
              v-for="qty in [1, 10, 50]"
              :key="qty"
              size="xs"
              variant="soft"
              color="error"
              :disabled="item.quantity === 0"
              :loading="selling[`${stackKey(item)}-${Math.min(qty, item.quantity)}`]"
              @click="requestSell(item, Math.min(qty, item.quantity))"
            >
              <span class="tabular-nums font-semibold">×{{ qty }}</span>
            </UButton>
            <UButton
              size="xs"
              variant="soft"
              color="error"
              :disabled="keepSellQty(item) === 0"
              :loading="selling[`keep-${stackKey(item)}`]"
              :label="`−${keepAmount}`"
              @click="doSellKeep(item)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ── BUY TAB ── -->
    <div v-else-if="activeTab === 'buy'">
      <div v-if="!unlockedTypeIds.length" class="text-sm text-muted py-12 text-center">
        Harvest plants from the grid first to unlock them for purchase.
      </div>

      <div v-else class="space-y-2">
        <div v-if="!buyablePlants.length" class="text-sm text-muted py-12 text-center">
          No unlocked plants match your filter.
        </div>

        <div
          v-for="plant in buyablePlants"
          :key="plant.id"
          class="rounded-xl border border-default px-4 py-3 flex items-center gap-4"
          :class="tierBg(plant.tier)"
        >
          <!-- Emoji -->
          <div class="shrink-0 flex flex-col items-center gap-1.5 w-10">
            <UTooltip :delay-duration="300" :content="{ side: 'right', sideOffset: 8 }">
              <template #content>
                <XenoPlantTooltipContent
                  :name="plant.name"
                  :tier="plant.tier"
                  :color="plant.color"
                  :speed="plant.speed"
                  :yield="plant.yield"
                  :base-time="plant.baseTime"
                  :value="plant.value"
                  :description="plant.description"
                />
              </template>
              <span class="text-2xl leading-none cursor-default">{{ plant.emoji }}</span>
            </UTooltip>
          </div>

          <!-- Plant info -->
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

          <!-- Price per unit -->
          <div class="text-right shrink-0 hidden sm:block">
            <p class="text-xs text-muted tabular-nums flex items-center gap-1"><CoinBalance :value="plant.buyPrice" :compact="false" /> ea</p>
          </div>

          <!-- Buy buttons -->
          <div class="flex gap-1 shrink-0">
            <UButton
              v-for="qty in [1, 10]"
              :key="qty"
              size="xs"
              variant="soft"
              color="success"
              :disabled="balance < plant.buyPrice * qty"
              :loading="buying[`${plant.id}-${qty}`]"
              @click="doBuy(plant.id, qty)"
            >
              <span class="tabular-nums font-semibold">×{{ qty }}</span>
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ── HYBRIDS TAB ── -->
    <div v-else>
      <!-- Locked -->
      <div v-if="!hybrids.unlocked" class="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div class="text-5xl opacity-60">🧬</div>
        <h2 class="text-lg font-bold">Hybrid vendor locked</h2>
        <p class="text-sm text-muted max-w-sm">
          Unlock <span class="font-bold text-primary">every T{{ hybrids.unlockTier }} plant</span> to access gambled
          hybrids — a single plant that harvests into up to 4 different resources at once.
        </p>
        <div v-if="hybrids.nextTierProgress" class="rounded-xl border border-default bg-elevated/40 p-4 text-left w-full max-w-md">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-bold uppercase tracking-wider text-muted">Unlock all T{{ hybrids.nextTierProgress.tier }} plants</p>
            <span class="text-xs font-black tabular-nums">{{ hybrids.nextTierProgress.unlocked }}/{{ hybrids.nextTierProgress.total }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2.5">
            <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${(hybrids.nextTierProgress.unlocked / hybrids.nextTierProgress.total) * 100}%` }" />
          </div>
          <div v-if="hybrids.nextTierProgress.missing.length" class="flex flex-wrap items-center gap-1.5">
            <span class="text-[10px] text-muted uppercase tracking-wider font-semibold">Still need</span>
            <span
              v-for="m in hybrids.nextTierProgress.missing"
              :key="m.id"
              class="inline-flex items-center gap-1 text-xs rounded-md border border-default bg-background/50 px-1.5 py-0.5"
            >
              <span class="leading-none">{{ m.emoji }}</span><span class="text-muted">{{ m.name }}</span>
            </span>
          </div>
        </div>
        <p class="text-xs text-muted/70 max-w-sm">
          Tip: harvest a plant at least once to unlock it. Unlock all of T5 later and hybrids will roll up to T5.
        </p>
      </div>

      <!-- Gamble panel -->
      <div v-else class="space-y-5">
        <div class="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/[0.02] p-6 text-center">
          <div class="text-5xl mb-2">🧬</div>
          <h2 class="text-lg font-black">Roll a T{{ hybrids.tier }} Hybrid</h2>
          <p class="text-sm text-muted mt-1 max-w-md mx-auto">
            Produces 1–4 random resources (≈5% for all 4) — any plant up to <span class="font-semibold text-default">T{{ hybrids.tier }}</span> —
            with random speed &amp; yield up to {{ hybrids.tier }}. Hybrids can't be bred, but you can farm and sell them.
          </p>

          <!-- Reveal -->
          <Transition
            enter-from-class="opacity-0 scale-90"
            enter-active-class="transition-all duration-300 ease-out"
          >
            <div
              v-if="lastRoll"
              :key="`${lastRoll.typeId}-${recentRolls.length}`"
              class="mt-5 mx-auto max-w-sm rounded-xl border border-default bg-background/60 p-4"
              :class="tierBg(!lastRoll.isHybrid ? lastRoll.resources[0].tier : lastRoll.resources.length >= 4 ? 7 : lastRoll.resources.length)"
            >
              <div class="flex items-center justify-center gap-1.5 mb-3">
                <span class="text-[10px] font-black uppercase tracking-[0.2em]" :class="lastRoll.isHybrid && lastRoll.resources.length >= 4 ? 'text-primary' : 'text-muted'">
                  {{ !lastRoll.isHybrid ? 'Plant' : lastRoll.resources.length === 4 ? '✨ Quad ✨' : `${lastRoll.resources.length}-resource Hybrid` }}
                </span>
              </div>

              <!-- Per-resource breakdown -->
              <div class="space-y-1.5">
                <div
                  v-for="r in lastRoll.resources"
                  :key="r.id"
                  class="flex items-center gap-2 rounded-lg bg-background/50 border border-default/50 px-2.5 py-1.5"
                >
                  <span class="text-xl leading-none">{{ r.emoji }}</span>
                  <span class="text-sm font-semibold flex-1 text-left truncate" :class="tierNameColor(r.tier)">{{ r.name }}</span>
                  <XenoLevelBadge prefix="S" :level="r.speed" />
                  <XenoLevelBadge prefix="Y" :level="r.yield" />
                </div>
              </div>

              <p v-if="lastRoll.isHybrid" class="text-[11px] text-muted mt-2.5">
                Vessel — harvest yields all {{ lastRoll.resources.length }} plants and regrows the hybrid.
              </p>
              <p v-else class="text-[11px] text-muted mt-2.5">Added to inventory.</p>
            </div>
          </Transition>

          <UButton
            class="mt-5"
            size="lg"
            color="primary"
            :loading="rolling"
            :disabled="gems < hybrids.costGems"
            @click="doRollHybrid"
          >
            <span class="flex items-center gap-2">
              <UIcon name="i-lucide-dices" class="size-5" />
              Roll — {{ formatNumber(hybrids.costGems, false) }} 💎
            </span>
          </UButton>
          <p v-if="gems < hybrids.costGems" class="text-xs text-error mt-2">
            Not enough gems (you have {{ formatNumber(gems, false) }} 💎)
          </p>
        </div>

        <!-- Upgrade to next tier -->
        <div v-if="hybrids.nextTierProgress" class="rounded-xl border border-default bg-elevated/40 p-4">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-bold uppercase tracking-wider text-muted">
              Unlock all T{{ hybrids.nextTierProgress.tier }} plants → roll up to T{{ hybrids.nextTierProgress.tier }}
            </p>
            <span class="text-xs font-black tabular-nums">{{ hybrids.nextTierProgress.unlocked }}/{{ hybrids.nextTierProgress.total }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2.5">
            <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${(hybrids.nextTierProgress.unlocked / hybrids.nextTierProgress.total) * 100}%` }" />
          </div>
          <div v-if="hybrids.nextTierProgress.missing.length" class="flex flex-wrap items-center gap-1.5">
            <span class="text-[10px] text-muted uppercase tracking-wider font-semibold">Still need</span>
            <span
              v-for="m in hybrids.nextTierProgress.missing"
              :key="m.id"
              class="inline-flex items-center gap-1 text-xs rounded-md border border-default bg-background/50 px-1.5 py-0.5"
            >
              <span class="leading-none">{{ m.emoji }}</span><span class="text-muted">{{ m.name }}</span>
            </span>
          </div>
        </div>

        <!-- Recent rolls -->
        <div v-if="recentRolls.length">
          <p class="text-xs text-muted uppercase tracking-wider font-semibold mb-2">Recent rolls</p>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="(roll, i) in recentRolls"
              :key="i"
              class="rounded-lg border border-default bg-elevated/50 px-2.5 py-1.5 flex items-center gap-1"
              :class="roll.isHybrid && roll.resources.length >= 4 ? 'ring-1 ring-primary/50' : ''"
            >
              <span v-if="roll.isHybrid" class="text-[10px] mr-0.5">🧬</span>
              <span v-for="r in roll.resources" :key="r.id" class="text-base" :title="`${r.name} · S${r.speed} Y${r.yield}`">{{ r.emoji }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </UContainer>

  <!-- Confirm sell-all stack modal -->
  <UModal
    :open="!!confirmSell"
    title="Sell all of this stack?"
    @update:open="(v) => { if (!v) confirmSell = null }"
  >
    <template #body>
      <div v-if="confirmSell" class="space-y-4">
        <p class="text-sm text-muted">
          You're about to sell all <span class="font-bold text-default">{{ confirmSell.item.quantity }}×
          {{ confirmSell.item.name }}</span> (S{{ confirmSell.item.speed }} Y{{ confirmSell.item.yield }}).
          This will leave you with <span class="font-bold text-error">0</span> of this stack.
        </p>
        <div class="flex items-center gap-1.5 text-sm font-semibold">
          <span>Total:</span>
          <CoinBalance :value="confirmSell.item.value * confirmSell.item.quantity" :compact="false" />
        </div>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" color="neutral" label="Cancel" @click="confirmSell = null" />
          <UButton
            color="error"
            label="Sell All"
            :loading="selling[`${stackKey(confirmSell.item)}-${confirmSell.item.quantity}`]"
            @click="doSell(confirmSell.item, confirmSell.item.quantity)"
          />
        </div>
      </div>
    </template>
  </UModal>

  <!-- Confirm sell-all keep N modal -->
  <UModal
    :open="confirmKeepSellAll"
    :title="`Sell all — keep ${keepAmount} per stack?`"
    @update:open="(v) => { if (!v) confirmKeepSellAll = false }"
  >
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
          <UButton
            color="error"
            icon="i-lucide-trending-down"
            :label="`Sell — keep ${keepAmount}`"
            @click="doSellKeepAll"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
