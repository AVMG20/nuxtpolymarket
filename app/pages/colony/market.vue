<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAX_TRAIT_PCT, MAX_GEMS_PER_DAY } from '#shared/utils/colony'
import { tierColor, tierBg, levelTextColor } from '#shared/utils/xeno'
import { formatDuration, tickTimeTextColor, traitTextColor } from '~/utils/colony-format'

const colony = useColony()
const { speciesCatalog, inventory, habitatLevel } = colony

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const tab = ref('buy')
const tabItems = [
  { label: 'Buy bugs', value: 'buy', icon: 'i-lucide-shopping-basket' },
  { label: 'Sell items', value: 'sell', icon: 'i-lucide-coins' }
]

const buyingId = ref<string | null>(null)
async function handleBuy(typeId: string) {
  if (buyingId.value) return
  buyingId.value = typeId
  try {
    await colony.buyBug(typeId)
  } finally {
    buyingId.value = null
  }
}

/**
 * Coins/hr at the guaranteed floor. Every cycle rolls 1 + random(0..yield)
 * items — the minimum is always 1, regardless of the rolled yield level —
 * so the true floor is the same "at least 1 per cycle" for every bug, at
 * 0% speed.
 */
function baseCoinsPerHour(species: any): number {
  if (!species.baseTickMs) return 0
  return (1 / species.baseTickMs) * 3_600_000 * species.itemSellValue
}

/** Nutrition/hr at the guaranteed floor — lowest possible eat roll, 0% speed. Eating scales with how often a bug ticks, so this is a floor, not a fixed number. */
function baseFeedPerHour(species: any): number {
  if (!species.baseTickMs) return 0
  return (species.eatMin / species.baseTickMs) * 3_600_000
}

const sellableItems = computed(() => inventory.value.filter((i: any) => i.quantity > 0))
const emptyItems = computed(() => inventory.value.filter((i: any) => i.quantity <= 0))
const totalSellValue = computed(() => sellableItems.value.reduce((sum: number, i: any) => sum + i.quantity * i.sellValue, 0))

// ── Search / tier filter ────────────────────────────────────────────────────
const sellSearch = ref('')
const sellTierFilter = ref(0)

const filteredSellItems = computed(() => {
  const q = sellSearch.value.toLowerCase()
  return [...sellableItems.value, ...emptyItems.value]
    .filter((i: any) => {
      if (sellTierFilter.value !== 0 && i.tier !== sellTierFilter.value) return false
      if (q && !i.name.toLowerCase().includes(q)) return false
      return true
    })
    .sort((a: any, b: any) => b.tier !== a.tier ? b.tier - a.tier : b.sellValue - a.sellValue)
})

// ── Keep setting (cookie-persisted, mirrors Xeno market) ────────────────────
const keepAmount = useCookie<number>('colony_market_keep', { default: () => 0 })
const keepInput = computed({
  get: () => keepAmount.value,
  set: (v) => { keepAmount.value = Math.max(0, Math.floor(Number(v) || 0)) }
})

function keepSellQty(item: any): number {
  return Math.max(0, item.quantity - keepAmount.value)
}

const keepSellableItems = computed(() => filteredSellItems.value.filter((i: any) => keepSellQty(i) > 0))
const keepSellTotalValue = computed(() => keepSellableItems.value.reduce((sum: number, i: any) => sum + i.sellValue * keepSellQty(i), 0))

const sellingId = ref<Record<string, boolean>>({})
async function doSell(itemTypeId: string, quantity: number) {
  const key = `${itemTypeId}-${quantity}`
  sellingId.value[key] = true
  try {
    await colony.sellItem(itemTypeId, quantity)
  } finally {
    sellingId.value[key] = false
  }
}

const confirmSell = ref<{ item: any, qty: number } | null>(null)
function requestSell(item: any, qty: number) {
  if (qty >= item.quantity) confirmSell.value = { item, qty }
  else doSell(item.id, qty)
}

const sellingKeep = ref<Record<string, boolean>>({})
async function doSellKeep(item: any) {
  const qty = keepSellQty(item)
  if (qty <= 0) return
  sellingKeep.value[item.id] = true
  try {
    await colony.sellItem(item.id, qty)
  } finally {
    sellingKeep.value[item.id] = false
  }
}

const confirmKeepSellAll = ref(false)
const sellingKeepAll = ref(false)
async function doSellKeepAll() {
  confirmKeepSellAll.value = false
  sellingKeepAll.value = true
  try {
    for (const item of keepSellableItems.value) {
      await colony.sellItem(item.id, keepSellQty(item))
    }
  } finally {
    sellingKeepAll.value = false
  }
}
</script>

<template>
  <div>
    <UContainer class="py-4 space-y-4">
      <UTabs
        v-model="tab"
        :items="tabItems"
        class="w-full"
      />

      <!-- Buy -->
      <template v-if="tab === 'buy'">
        <p class="text-xs text-muted">
          Every bug rolls a Speed trait (faster cycles) and a Yield level (each cycle drops 1 up to that level+1 items, never a percentage) within its species' current roll range — every species starts at 0-{{ MAX_TRAIT_PCT }}% speed / 1-2 yield. Sacrifice spare bugs on the
          <NuxtLink
            to="/colony/research"
            class="text-primary underline"
          >Research</NuxtLink> page to permanently widen a species' range. Bought bugs land in your inventory; place them from the Terrarium page.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <UCard
            v-for="species in speciesCatalog"
            :key="species.id"
            :class="!species.buyable && 'opacity-60'"
            :ui="{ body: 'p-0' }"
          >
            <div class="p-3 pb-2">
              <div class="flex items-start gap-3">
                <span
                  class="text-3xl leading-none size-12 flex items-center justify-center rounded-xl border shrink-0"
                  :class="tierBg(species.tier)"
                >{{ species.buyable ? species.emoji : '❔' }}</span>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-sm truncate flex items-center gap-1.5">
                    {{ species.buyable ? species.name : '???' }}
                    <span
                      class="text-xs font-black"
                      :class="tierColor(species.tier)"
                    >T{{ species.tier }}</span>
                  </p>
                  <div
                    v-if="species.buyable"
                    class="flex flex-wrap items-center gap-1.5 mt-1.5"
                  >
                    <UBadge
                      size="sm"
                      variant="subtle"
                      :color="species.social ? 'success' : 'warning'"
                      :icon="species.social ? 'i-lucide-users' : 'i-lucide-user'"
                    >
                      {{ species.social ? 'Social' : 'Solitary' }}
                    </UBadge>
                    <span
                      class="inline-flex items-center gap-1 rounded-full border border-default bg-elevated px-2 py-0.5 text-[11px] font-bold"
                      :class="tickTimeTextColor(species.baseTickMs)"
                      title="Cycle time — every cycle this bug drops loot. Speed traits and habitat upgrades shorten it."
                    >
                      <UIcon
                        name="i-lucide-zap"
                        class="size-3"
                      />
                      {{ formatDuration(species.baseTickMs) }}
                    </span>
                    <span
                      v-if="!species.producesGems"
                      class="inline-flex items-center gap-1 rounded-full border border-default bg-elevated px-2 py-0.5 text-[11px] font-bold"
                      :class="traitTextColor(species.speedMin)"
                      title="Speed trait roll range for this species right now — sacrifice spares on the Research page to widen it."
                    >
                      <UIcon
                        name="i-lucide-zap"
                        class="size-3"
                      />
                      {{ species.speedMin }}–{{ species.speedMax }}%
                    </span>
                    <span
                      v-if="!species.producesGems"
                      class="inline-flex items-center gap-1 rounded-full border border-default bg-elevated px-2 py-0.5 text-[11px] font-bold"
                      :class="levelTextColor(species.yieldMin)"
                      title="Yield level rolled on purchase — each cycle drops 1 up to level+1 items (never a flat number or a percentage). Sacrifice spares on the Research page to widen this range."
                    >
                      <UIcon
                        name="i-lucide-gem"
                        class="size-3"
                      />
                      Yield {{ species.yieldMin }}–{{ species.yieldMax }}
                    </span>
                    <span
                      v-if="species.producesGems"
                      class="inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 text-info px-2 py-0.5 text-[11px] font-bold"
                      title="Solitary gem-forager — fixed 24h cycle time, immune to speed upgrades. Foraging Yield/Speed instead boost how many gems it earns per cycle. Crowding only ever slows the cycle down."
                    >
                      <UIcon
                        name="i-lucide-gem"
                        class="size-3"
                      />
                      Gem forager
                    </span>
                    <UBadge
                      v-if="species.researchLevel > 0"
                      size="sm"
                      variant="subtle"
                      color="primary"
                    >
                      Research Lv {{ species.researchLevel }}
                    </UBadge>
                    <span
                      class="inline-flex items-center gap-1 rounded-full border border-default bg-elevated px-2 py-0.5 text-[11px] font-bold text-muted"
                      title="Eat rate rolled on purchase — nutrition spent per completed cycle, not per hour. Faster cycles mean more meals."
                    >
                      <UIcon
                        name="i-lucide-utensils"
                        class="size-3"
                      />
                      Eats {{ species.eatMin }}–{{ species.eatMax }}
                    </span>
                  </div>
                  <p class="text-xs text-muted mt-1.5 line-clamp-2">
                    {{ species.buyable ? species.description : `Requires Habitat Level ${species.tier} (you are ${habitatLevel})` }}
                  </p>
                </div>
              </div>
            </div>

            <template v-if="species.buyable">
              <div class="px-3 pb-3 pt-0.5 space-y-1.5">
                <div class="space-y-0.5 text-xs">
                  <div class="flex items-center justify-between">
                    <span class="text-muted">Forages</span>
                    <span class="font-medium">{{ species.itemEmoji }} {{ species.itemName }}</span>
                  </div>
                  <div
                    v-if="species.producesGems"
                    class="flex items-center justify-between"
                  >
                    <span
                      class="text-muted"
                      title="Forages gems instead of coins — very slow at base (~1/24h). Investing in the Foraging Yield or Foraging Speed habitat tracks raises this, hard-capped at the max."
                    >Gems</span>
                    <span class="font-medium">💎 ~1 / 24h (up to {{ MAX_GEMS_PER_DAY }} / 24h)</span>
                  </div>
                  <div
                    v-else
                    class="flex items-center justify-between"
                  >
                    <span
                      class="text-muted"
                      title="Assumes the worst-case roll (1 item/cycle, every bug's guaranteed minimum) and 0% speed — the honest floor."
                    >Floor income</span>
                    <span class="font-medium flex items-center gap-1">
                      ~<CoinBalance
                        :value="Math.round(baseCoinsPerHour(species))"
                        :compact="false"
                        :show-icon="false"
                      />/hr
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span
                      class="text-muted"
                      title="Assumes the lowest possible eat roll and 0% speed — the guaranteed floor. Faster cycles (from speed rolls or habitat upgrades) raise this."
                    >Floor eats</span>
                    <span class="font-mono">~{{ formatNumber(Math.round(baseFeedPerHour(species)), false) }} nutrition/hr</span>
                  </div>
                  <div
                    v-if="species.owned > 0"
                    class="flex items-center justify-between"
                  >
                    <span class="text-muted">Owned</span>
                    <span class="font-mono">{{ species.owned }}</span>
                  </div>
                </div>

                <UButton
                  block
                  size="sm"
                  color="primary"
                  :loading="buyingId === species.id"
                  :disabled="balance < species.spawnCost"
                  @click="handleBuy(species.id)"
                >
                  <span class="flex items-center gap-1">
                    Buy —
                    <CoinBalance
                      :value="species.spawnCost"
                      :compact="false"
                      :show-icon="false"
                    />
                  </span>
                </UButton>
              </div>
            </template>
            <div
              v-else
              class="px-3 pb-3"
            >
              <UButton
                block
                size="sm"
                color="neutral"
                variant="soft"
                icon="i-lucide-lock"
                disabled
              >
                Locked — Habitat {{ species.tier }}
              </UButton>
            </div>
          </UCard>
        </div>
      </template>

      <!-- Sell -->
      <template v-if="tab === 'sell'">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <p class="text-xs text-muted">
            Sell foraged items for coins — or hoard them for Habitat upgrades, which get item-hungry fast.
          </p>
          <div class="text-right shrink-0">
            <p class="text-[10px] text-muted uppercase tracking-wider font-semibold">
              Portfolio value
            </p>
            <CoinBalance
              :value="totalSellValue"
              :compact="false"
              class="text-base font-black"
            />
          </div>
        </div>

        <!-- Filters -->
        <div class="flex gap-2">
          <UInput
            v-model="sellSearch"
            placeholder="Search items…"
            icon="i-lucide-search"
            size="sm"
            class="flex-1"
          />
          <USelect
            v-model="sellTierFilter"
            :items="[
              { label: 'All tiers', value: 0 },
              { label: 'T1', value: 1 },
              { label: 'T2', value: 2 },
              { label: 'T3', value: 3 },
              { label: 'T4', value: 4 },
              { label: 'T5', value: 5 },
              { label: 'T6', value: 6 }
            ]"
            size="sm"
            class="w-28"
          />
        </div>

        <!-- Sell settings bar -->
        <div class="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-default bg-elevated/50">
          <UIcon
            name="i-lucide-settings-2"
            class="size-3.5 text-muted shrink-0"
          />
          <span class="text-xs text-muted font-medium shrink-0">Keep per stack</span>
          <UInput
            v-model="keepInput"
            type="number"
            min="0"
            size="xs"
            class="w-20"
          />
          <div class="flex-1" />
          <CoinBalance
            v-if="keepSellTotalValue > 0"
            :value="keepSellTotalValue"
            :compact="false"
            class="text-xs text-muted shrink-0"
          />
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

        <div class="space-y-2">
          <div
            v-if="!filteredSellItems.length"
            class="text-sm text-muted py-12 text-center"
          >
            No items match your filter.
          </div>

          <div
            v-for="item in filteredSellItems"
            :key="item.id"
            class="rounded-xl border border-default px-4 py-3 flex items-center gap-4 transition-colors hover:border-primary/60 hover:bg-primary/5"
            :class="[tierBg(item.tier), item.quantity <= 0 && 'opacity-50']"
          >
            <!-- Emoji + qty -->
            <div class="shrink-0 flex items-center gap-2">
              <span
                class="text-2xl leading-none size-11 flex items-center justify-center rounded-xl border shrink-0"
                :class="tierBg(item.tier)"
              >{{ item.emoji }}</span>
              <span class="text-sm font-black text-primary tabular-nums leading-none">×{{ formatNumber(item.quantity, false) }}</span>
            </div>

            <!-- Item info -->
            <div class="flex-1 min-w-0">
              <p class="font-bold text-sm flex items-center gap-1.5">
                {{ item.name }}
                <span
                  class="text-xs font-black"
                  :class="tierColor(item.tier)"
                >T{{ item.tier }}</span>
              </p>
            </div>

            <!-- Total + price per unit -->
            <div class="text-right shrink-0 hidden sm:flex flex-col items-end gap-0.5">
              <CoinBalance
                :value="item.quantity * item.sellValue"
                :compact="false"
                class="text-sm font-bold"
              />
              <span class="text-xs text-muted tabular-nums flex items-center gap-1">
                <CoinBalance
                  :value="item.sellValue"
                  :compact="false"
                  :show-icon="false"
                /> ea
              </span>
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
                :loading="sellingId[`${item.id}-${Math.min(qty, item.quantity)}`]"
                @click="requestSell(item, Math.min(qty, item.quantity))"
              >
                <span class="tabular-nums font-semibold">×{{ qty }}</span>
              </UButton>
              <UButton
                size="xs"
                variant="soft"
                color="error"
                :disabled="keepSellQty(item) === 0"
                :loading="sellingKeep[item.id]"
                :label="`−${keepAmount}`"
                @click="doSellKeep(item)"
              />
            </div>
          </div>
        </div>
      </template>
    </UContainer>

    <!-- Confirm sell-all stack modal -->
    <UModal
      :open="!!confirmSell"
      title="Sell all of this stack?"
      @update:open="(v) => { if (!v) confirmSell = null }"
    >
      <template #body>
        <div
          v-if="confirmSell"
          class="space-y-4"
        >
          <p class="text-sm text-muted">
            You're about to sell all <span class="font-bold text-default">{{ confirmSell.item.quantity }}× {{ confirmSell.item.name }}</span>.
            This will leave you with <span class="font-bold text-error">0</span> of this stack.
          </p>
          <div class="flex items-center gap-1.5 text-sm font-semibold">
            <span>Total:</span>
            <CoinBalance
              :value="confirmSell.item.quantity * confirmSell.item.sellValue"
              :compact="false"
            />
          </div>
          <div class="flex gap-2 justify-end">
            <UButton
              variant="ghost"
              color="neutral"
              label="Cancel"
              @click="confirmSell = null"
            />
            <UButton
              color="error"
              label="Sell All"
              :loading="sellingId[`${confirmSell.item.id}-${confirmSell.item.quantity}`]"
              @click="doSell(confirmSell.item.id, confirmSell.item.quantity)"
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
            <CoinBalance
              :value="keepSellTotalValue"
              :compact="false"
            />
          </div>
          <div class="flex gap-2 justify-end">
            <UButton
              variant="ghost"
              color="neutral"
              label="Cancel"
              @click="confirmKeepSellAll = false"
            />
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
  </div>
</template>
