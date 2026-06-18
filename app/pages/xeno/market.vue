<script setup lang="ts">
import { tierColor, tierNameColor, plantBgOnly, getPlant, effectiveGrowTime, PLANT_TYPES } from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const { inventory, sellPlants, unlockedTypeIds, buyPlants } = useXeno()

const activeTab = ref<'sell' | 'buy'>('sell')
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
  return Math.round(plant.value * 2 * (1 + plant.yield) * (1 + plant.speed * 0.05))
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
  const base = getPlant(item.typeId ?? item.id)
  return base ? formatDuration(effectiveGrowTime({ baseTime: base.baseTime, speed: item.speed })) : '?'
}
</script>

<template>
  <UContainer>
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
    </div>

    <!-- Filters -->
    <div class="flex gap-2 mb-4">
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
          class="rounded-xl border border-default px-4 py-3 flex items-center gap-4"
          :class="plantBgOnly(item.color)"
        >
          <!-- Emoji + qty -->
          <div class="shrink-0 flex flex-col items-center gap-1.5 w-10">
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
                />
              </template>
              <span class="text-2xl leading-none cursor-default">{{ item.emoji }}</span>
            </UTooltip>
            <span class="text-xs font-black text-primary tabular-nums leading-none">×{{ item.quantity }}</span>
          </div>

          <!-- Plant info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <p class="font-bold text-sm" :class="tierNameColor(item.tier)">{{ item.name }}</p>
              <XenoTierLabel :tier="item.tier" />
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <XenoLevelBadge prefix="S" :level="item.speed" />
              <XenoLevelBadge prefix="Y" :level="item.yield" />
              <span class="text-xs text-muted">~{{ growTime(item) }}</span>
            </div>
          </div>

          <!-- Price per unit -->
          <div class="text-right shrink-0 hidden sm:block">
            <p class="text-xs text-muted tabular-nums flex items-center gap-1"><CoinBalance :value="item.value" :compact="false" /> ea</p>
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
    <div v-else>
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
          :class="plantBgOnly(plant.color)"
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
