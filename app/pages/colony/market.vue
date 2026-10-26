<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BUG_TYPES, MAX_GEMS_PER_DAY, TIER_NAMES } from '#shared/utils/colony'
import { formatDuration } from '~/lib/colony-format'

const colony = useColony()
const { speciesCatalog, inventory } = colony

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const route = useRoute()
const router = useRouter()
type ShopTab = 'hatchery' | 'trading'
const tab = computed<ShopTab>({
  get: () => route.query.tab === 'trading' ? 'trading' : 'hatchery',
  set: value => void router.replace({ query: { ...route.query, tab: value === 'trading' ? 'trading' : undefined } })
})

// ── Hatchery ────────────────────────────────────────────────────────────────
type HatchFilter = 'all' | 'owned' | 'affordable'
const hatchFilter = ref<HatchFilter>('all')
const hatchFilters: { label: string, value: HatchFilter }[] = [
  { label: 'All tiers', value: 'all' },
  { label: 'Owned', value: 'owned' },
  { label: 'Affordable', value: 'affordable' }
]
const visibleSpecies = computed(() => speciesCatalog.value.filter((species: any) => {
  if (hatchFilter.value === 'owned') return species.owned > 0
  if (hatchFilter.value === 'affordable') return species.buyable && balance.value >= species.spawnCost
  return true
}))

const buyingId = ref<string | null>(null)
interface HatchPop { id: number, typeId: string }
const hatchPops = ref<HatchPop[]>([])
let popSeq = 0

async function handleBuy(typeId: string) {
  if (buyingId.value) return
  buyingId.value = typeId
  try {
    await colony.buyBug(typeId)
    const id = popSeq++
    hatchPops.value.push({ id, typeId })
    setTimeout(() => {
      hatchPops.value = hatchPops.value.filter(p => p.id !== id)
    }, 1500)
  } catch {
    // useColony already showed the error
  } finally {
    buyingId.value = null
  }
}

/** Nutrition/hr at the guaranteed floor — lowest possible eat roll, 0% speed. Eating scales with how often a bug ticks, so this is a floor, not a fixed number. */
function baseFeedPerHour(species: any): number {
  if (!species.baseTickMs) return 0
  return (species.eatMin / species.baseTickMs) * 3_600_000
}

// ── Trading post ────────────────────────────────────────────────────────────
const sellableItems = computed(() => inventory.value.filter((i: any) => i.quantity > 0))
const emptyItems = computed(() => inventory.value.filter((i: any) => i.quantity <= 0))
const totalSellValue = computed(() => sellableItems.value.reduce((sum: number, i: any) => sum + i.quantity * i.sellValue, 0))

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
    .sort((a: any, b: any) => Number(b.quantity > 0) - Number(a.quantity > 0) || b.tier - a.tier || b.sellValue - a.sellValue)
})

function foragedBy(itemId: string) {
  return BUG_TYPES.find(b => b.itemId === itemId && !b.prestigeOnly)
}

// Keep setting (cookie-persisted, mirrors Xeno market)
const keepAmount = useCookie<number>('colony_market_keep', { default: () => 0 })
const keepModel = ref(Math.max(0, Math.floor(Number(keepAmount.value) || 0)))
watch(keepModel, (v) => { keepAmount.value = Math.max(0, Math.floor(v || 0)) })
const keepText = useAmountInput(keepModel, { integer: true, shorthand: true })

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
function confirmSellStack() {
  if (!confirmSell.value) return
  const { item } = confirmSell.value
  confirmSell.value = null
  doSell(item.id, item.quantity)
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
    // Each sell drops its stack locally at once, so they can all be queued
    // together; the header is settled once when the last one is done.
    await Promise.allSettled(keepSellableItems.value.map((item: any) => colony.sellItem(item.id, keepSellQty(item), { settleWallet: false })))
    await colony.fetchSession()
  } finally {
    sellingKeepAll.value = false
  }
}
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 py-4 md:p-6 space-y-4">
    <!-- Shop signs -->
    <div
      class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5"
      role="tablist"
      aria-label="Market"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'hatchery'"
        class="cl-panel text-left px-4 py-3 sm:px-[18px] sm:py-4 flex gap-3.5 items-center transition-colors"
        :class="tab === 'hatchery' ? 'cl-selected' : 'opacity-75 hover:opacity-100'"
        @click="tab = 'hatchery'"
      >
        <span class="text-2xl sm:text-3xl">🥚</span>
        <span class="min-w-0">
          <span class="cl-display block text-xl sm:text-2xl font-semibold">Hatchery</span>
          <span class="text-[13px] text-muted">Buy bugs. Each egg rolls its own speed and yield.</span>
        </span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'trading'"
        class="cl-panel text-left px-4 py-3 sm:px-[18px] sm:py-4 flex gap-3.5 items-center transition-colors"
        :class="tab === 'trading' ? 'cl-selected' : 'opacity-75 hover:opacity-100'"
        @click="tab = 'trading'"
      >
        <span class="text-2xl sm:text-3xl">⚖️</span>
        <span class="min-w-0 flex-1">
          <span class="cl-display block text-xl sm:text-2xl font-semibold">Trading Post</span>
          <span class="text-[13px] text-muted">Sell forage for coins, or hoard it for Habitat builds.</span>
        </span>
        <span
          v-if="totalSellValue > 0"
          class="cl-chip cl-chip-gold cl-num shrink-0 hidden min-[420px]:inline-flex"
        >≈ {{ formatNumber(totalSellValue) }}</span>
      </button>
    </div>

    <!-- Hatchery -->
    <template v-if="tab === 'hatchery'">
      <div class="flex gap-2 flex-wrap items-center">
        <button
          v-for="f in hatchFilters"
          :key="f.value"
          type="button"
          class="cl-chip"
          :class="hatchFilter === f.value && 'cl-chip-gold'"
          :aria-pressed="hatchFilter === f.value"
          @click="hatchFilter = f.value"
        >
          {{ f.label }}
        </button>
        <span class="flex-1" />
        <p class="text-[13px] text-muted w-full sm:w-auto">
          Rolls widen with <NuxtLink
            to="/colony/research"
            class="text-amber-400 underline"
          >Research</NuxtLink>. New bugs land in the Burrow.
        </p>
      </div>

      <div
        v-if="visibleSpecies.length"
        class="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4"
      >
        <article
          v-for="species in visibleSpecies"
          :key="species.id"
          class="cl-bug pb-3"
          :class="[`cl-t${species.tier}`, species.producesGems && 'cl-tgem', !species.buyable && 'cl-bug-dim']"
        >
          <span class="cl-bug-tier">T{{ species.tier }} · {{ TIER_NAMES[species.tier] }}</span>
          <span
            v-if="species.researchLevel > 0 && species.buyable"
            class="cl-bug-qty text-green-300"
            :title="`Research level ${species.researchLevel}`"
          >R{{ species.researchLevel }}</span>
          <div class="cl-bug-art h-[96px] mt-5">
            <span
              class="cl-bug-emoji text-[44px]"
              :class="!species.buyable && 'cl-silhouette'"
            >{{ species.emoji }}</span>
            <span
              v-for="p in hatchPops.filter(pop => pop.typeId === species.id)"
              :key="p.id"
              class="cl-float top-2 left-1/2"
            >+1 {{ species.emoji }}</span>
          </div>
          <div class="px-3.5 flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <span class="cl-display text-xl font-semibold truncate">{{ species.buyable ? species.name : '???' }}</span>
              <span
                v-if="species.buyable"
                class="cl-chip shrink-0"
                :class="species.social ? 'cl-chip-green' : 'cl-chip-warn'"
              >
                <UIcon
                  :name="species.social ? 'i-lucide-users' : 'i-lucide-user'"
                  class="size-3"
                />
                {{ species.social ? 'Social' : 'Solitary' }}
              </span>
            </div>
            <p class="text-[12.5px] text-muted min-h-[34px]">
              {{ species.buyable ? species.description : `Dig to Habitat ${species.tier} to meet this ${TIER_NAMES[species.tier]?.toLowerCase()} forager.` }}
            </p>

            <template v-if="species.buyable">
              <div class="grid grid-cols-2 gap-1.5">
                <div class="cl-inset px-2 py-1.5">
                  <p class="cl-eyebrow text-[10px]">
                    Cycle
                  </p>
                  <p class="cl-num font-semibold">
                    {{ formatDuration(species.baseTickMs) }}
                  </p>
                </div>
                <div class="cl-inset px-2 py-1.5">
                  <p class="cl-eyebrow text-[10px]">
                    Speed roll
                  </p>
                  <p class="cl-num font-semibold text-yellow-300">
                    {{ species.producesGems ? 'Fixed' : `${species.speedMin}–${species.speedMax}%` }}
                  </p>
                </div>
                <div class="cl-inset px-2 py-1.5">
                  <p class="cl-eyebrow text-[10px]">
                    Output
                  </p>
                  <p class="cl-num font-semibold text-sky-300">
                    {{ species.producesGems ? `1–${MAX_GEMS_PER_DAY} gems/day` : `Y${species.yieldMin}–${species.yieldMax} · ×${species.resourceMultiplier}` }}
                  </p>
                </div>
                <div class="cl-inset px-2 py-1.5">
                  <p class="cl-eyebrow text-[10px]">
                    Appetite
                  </p>
                  <p
                    class="cl-num font-semibold"
                    :title="`At least ~${formatNumber(Math.round(baseFeedPerHour(species)), false)} nutrition per hour`"
                  >
                    {{ species.eatMin }}–{{ species.eatMax }} / cycle
                  </p>
                </div>
              </div>
              <div class="flex justify-between gap-2 text-[12.5px]">
                <span class="text-muted truncate">Forages {{ species.itemEmoji }} {{ species.itemName }}</span>
                <span class="cl-num font-semibold shrink-0">Owned {{ species.owned }}</span>
              </div>
              <button
                type="button"
                class="cl-btn cl-btn-green w-full"
                :disabled="balance < species.spawnCost || !!buyingId"
                @click="handleBuy(species.id)"
              >
                <UIcon
                  v-if="buyingId === species.id"
                  name="i-lucide-loader-circle"
                  class="size-4 animate-spin"
                />
                <ColonyCurrencyIcon
                  v-else
                  :size="18"
                />
                Hatch · {{ formatNumber(species.spawnCost) }}
              </button>
            </template>
            <template v-else>
              <div class="cl-inset p-2.5 text-center text-[12.5px] text-muted">
                Costs <span class="cl-num font-semibold text-default">{{ formatNumber(species.spawnCost) }}</span> once unlocked
              </div>
              <button
                type="button"
                class="cl-btn cl-btn-ghost w-full"
                disabled
              >
                <UIcon
                  name="i-lucide-lock"
                  class="size-4"
                />
                Habitat {{ species.tier }} unlocks
              </button>
            </template>
          </div>
        </article>
      </div>
      <p
        v-else
        class="text-sm text-muted text-center py-12"
      >
        {{ hatchFilter === 'owned' ? 'You don\'t own any bugs yet.' : 'Nothing you can afford right now.' }}
      </p>
    </template>

    <!-- Trading post -->
    <template v-if="tab === 'trading'">
      <div class="cl-panel px-4 py-3.5 sm:px-[18px] sm:py-4 flex flex-wrap gap-4 items-center border-amber-400/45">
        <div class="flex-[1_1_200px]">
          <p class="cl-eyebrow">
            Stores worth
          </p>
          <p class="cl-display cl-num text-3xl sm:text-[34px] font-semibold text-amber-400 leading-tight">
            {{ formatNumber(Math.round(totalSellValue), false) }}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <label class="flex items-center gap-2 text-[13px] font-semibold text-muted">
            Keep per stack
            <UInput
              v-model="keepText"
              inputmode="decimal"
              size="md"
              class="w-28"
              placeholder="0"
            >
              <template
                v-if="amountPreview(keepText, true)"
                #trailing
              >
                <span class="text-xs tabular-nums text-muted">{{ amountPreview(keepText, true) }}</span>
              </template>
            </UInput>
          </label>
          <button
            type="button"
            class="cl-btn cl-btn-gold flex-1 sm:flex-none"
            :disabled="!keepSellableItems.length || sellingKeepAll"
            @click="confirmKeepSellAll = true"
          >
            <UIcon
              v-if="sellingKeepAll"
              name="i-lucide-loader-circle"
              class="size-4 animate-spin"
            />
            Sell all · keep {{ formatNumber(keepAmount) }}<template v-if="keepSellTotalValue > 0">
              · +{{ formatNumber(keepSellTotalValue) }}
            </template>
          </button>
        </div>
      </div>

      <div class="flex gap-2 flex-wrap items-center">
        <UInput
          v-model="sellSearch"
          placeholder="Search items…"
          icon="i-lucide-search"
          size="md"
          class="w-full sm:w-64"
        />
        <div class="flex gap-1.5 flex-wrap">
          <button
            v-for="t in [0, 1, 2, 3, 4, 5, 6]"
            :key="t"
            type="button"
            class="cl-chip"
            :class="sellTierFilter === t ? 'cl-chip-gold' : t ? `cl-t${t} cl-tc` : ''"
            :aria-pressed="sellTierFilter === t"
            @click="sellTierFilter = t"
          >
            {{ t ? `T${t}` : 'All' }}
          </button>
        </div>
      </div>

      <div
        v-if="filteredSellItems.length"
        class="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3 sm:gap-3.5"
      >
        <div
          v-for="item in filteredSellItems"
          :key="item.id"
          class="cl-crate gap-1.5 px-3 pt-3.5 pb-3"
          :class="[`cl-t${item.tier}`, item.quantity <= 0 && 'cl-crate-empty']"
        >
          <span class="self-stretch flex justify-between text-xs font-semibold cl-num">
            <span class="cl-tc">T{{ item.tier }}</span>
            <span class="text-muted truncate">by {{ foragedBy(item.id)?.name ?? '???' }}</span>
          </span>
          <span class="text-[40px] sm:text-[44px] leading-tight">{{ item.emoji }}</span>
          <span class="cl-display text-[15px] sm:text-base font-semibold text-center leading-tight">{{ item.name }}</span>
          <span class="cl-display cl-num text-2xl sm:text-[26px] font-semibold">{{ formatNumber(item.quantity, false) }}</span>
          <span class="cl-num text-[12px] font-semibold text-muted text-center">
            {{ formatNumber(item.sellValue) }} each · <span class="text-amber-400">{{ item.quantity > 0 ? formatNumber(item.quantity * item.sellValue) : 'none' }}</span>
          </span>
          <div class="flex gap-1.5 self-stretch mt-1">
            <button
              type="button"
              class="cl-btn cl-btn-ghost cl-btn-sm flex-1 min-w-0 px-1.5"
              :disabled="keepSellQty(item) === 0 || sellingKeep[item.id]"
              :title="`Sell all but ${formatNumber(keepAmount, false)}`"
              @click="doSellKeep(item)"
            >
              <span class="truncate">−{{ formatNumber(keepSellQty(item)) }}</span>
            </button>
            <button
              type="button"
              class="cl-btn cl-btn-gold cl-btn-sm flex-1 min-w-0 px-1.5"
              :disabled="item.quantity === 0"
              @click="requestSell(item, item.quantity)"
            >
              Sell all
            </button>
          </div>
          <div class="flex gap-1 self-stretch">
            <button
              v-for="qty in [1, 10, 50]"
              :key="qty"
              type="button"
              class="cl-btn cl-btn-ghost cl-btn-xs flex-1 min-w-0 px-1"
              :disabled="item.quantity === 0 || sellingId[`${item.id}-${Math.min(qty, item.quantity)}`]"
              :aria-label="`Sell ${qty} ${item.name}`"
              @click="requestSell(item, Math.min(qty, item.quantity))"
            >
              ×{{ qty }}
            </button>
          </div>
        </div>
      </div>
      <p
        v-else
        class="text-sm text-muted py-12 text-center"
      >
        No items match your filter.
      </p>
    </template>

    <!-- Confirm selling a whole stack -->
    <ColonyConfirmSheet
      :open="!!confirmSell"
      title="Sell the whole stack?"
      @close="confirmSell = null"
    >
      <div
        v-if="confirmSell"
        class="cl-inset px-3.5 py-3 flex items-center gap-3"
      >
        <span class="text-3xl">{{ confirmSell.item.emoji }}</span>
        <span class="flex-1 min-w-0">
          <span class="block font-semibold">{{ formatNumber(confirmSell.item.quantity, false) }}× {{ confirmSell.item.name }}</span>
          <span class="text-xs text-muted">Leaves you with none of this stack.</span>
        </span>
        <span class="cl-display cl-num text-xl font-semibold text-amber-400">+{{ formatNumber(confirmSell.item.quantity * confirmSell.item.sellValue) }}</span>
      </div>
      <template #actions="{ ready }">
        <button
          type="button"
          class="cl-btn cl-btn-ghost"
          @click="confirmSell = null"
        >
          Keep it
        </button>
        <button
          type="button"
          class="cl-btn cl-btn-gold"
          @click="ready && confirmSellStack()"
        >
          Sell all
        </button>
      </template>
    </ColonyConfirmSheet>

    <!-- Confirm sell-all, keeping N per stack -->
    <ColonyConfirmSheet
      :open="confirmKeepSellAll"
      :title="`Sell all, keep ${formatNumber(keepAmount, false)}?`"
      :description="`Sells the surplus from ${keepSellableItems.length} ${keepSellableItems.length === 1 ? 'stack' : 'stacks'}, keeping up to ${formatNumber(keepAmount, false)} of each.`"
      @close="confirmKeepSellAll = false"
    >
      <div class="cl-inset px-3.5 py-3 flex justify-between items-center font-semibold">
        <span>You'll receive</span>
        <span class="cl-display cl-num text-xl text-amber-400 flex items-center gap-1.5">
          <ColonyCurrencyIcon :size="18" />
          {{ formatNumber(Math.round(keepSellTotalValue), false) }}
        </span>
      </div>
      <template #actions="{ ready }">
        <button
          type="button"
          class="cl-btn cl-btn-ghost"
          @click="confirmKeepSellAll = false"
        >
          Cancel
        </button>
        <button
          type="button"
          class="cl-btn cl-btn-gold"
          @click="ready && doSellKeepAll()"
        >
          Sell · keep {{ formatNumber(keepAmount) }}
        </button>
      </template>
    </ColonyConfirmSheet>
  </div>
</template>
