<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAX_TRAIT_PCT, MAX_GEMS_PER_DAY, TIER_NAMES } from '#shared/utils/colony'
import { tierColor, tierBg } from '#shared/utils/xeno'
import { formatDuration } from '~/lib/colony-format'

const colony = useColony()
const { speciesCatalog, inventory, habitatLevel } = colony
const sound = useColonySound()
const fx = useColonyFx()

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const tab = ref<'buy' | 'sell'>('buy')

const buyingId = ref<string | null>(null)
const lastBought = ref<{ id: string; speed: number; yield: number; eat: number } | null>(null)

async function handleBuy(species: any, ev: MouseEvent) {
  if (buyingId.value) return
  buyingId.value = species.id
  const el = (ev.currentTarget as Element).closest('.colony-card') ?? (ev.currentTarget as Element)
  try {
    const res = await colony.buyBug(species.id)
    sound.play('buy')
    if (res) {
      lastBought.value = { id: species.id, speed: res.speed, yield: res.yield, eat: res.eat }
      setTimeout(() => { if (lastBought.value?.id === species.id) lastBought.value = null }, 3500)
    }
    fx.celebrate(el, { emoji: [species.emoji, '✨', '🪙'], count: 14, text: res ? `⚡${res.speed}% · 💎${res.yield}` : undefined })
  } catch {
    sound.play('error')
  } finally {
    buyingId.value = null
  }
}

function baseFeedPerHour(species: any): number {
  if (!species.baseTickMs) return 0
  return (species.eatMin / species.baseTickMs) * 3_600_000
}

/** Rough coins/hr at an average roll, so a shopper can compare species. */
function estCoinsPerHour(species: any): number {
  if (species.producesGems || !species.baseTickMs) return 0
  const avgSpeed = (species.speedMin + species.speedMax) / 2
  const avgYield = 1 + ((species.yieldMin + species.yieldMax) / 2) / 2
  const tick = species.baseTickMs * (1 - avgSpeed / 100)
  return (avgYield * species.resourceMultiplier / tick) * 3_600_000 * (species.itemSellValue ?? 0)
}

function paybackDays(species: any): number | null {
  const cph = estCoinsPerHour(species)
  return cph > 0 ? species.spawnCost / cph / 24 : null
}

const groupedCatalog = computed(() => {
  const groups = new Map<number, any[]>()
  for (const s of speciesCatalog.value) {
    if (!groups.has(s.tier)) groups.set(s.tier, [])
    groups.get(s.tier)!.push(s)
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0])
})

// ── Sell ───────────────────────────────────────────────────────────────────
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
    .sort((a: any, b: any) => b.tier !== a.tier ? b.tier - a.tier : b.sellValue - a.sellValue)
})

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
async function doSell(itemTypeId: string, quantity: number, el?: Element | null) {
  const key = `${itemTypeId}-${quantity}`
  sellingId.value[key] = true
  try {
    const res = await colony.sellItem(itemTypeId, quantity)
    sound.play(res?.coins >= 50_000 ? 'coins' : 'sell')
    if (el) fx.celebrate(el, { emoji: ['🪙', '💰'], count: Math.min(16, 4 + Math.round(Math.log10((res?.coins ?? 1) + 1) * 2)), text: res?.coins ? `+${formatNumber(res.coins)} 🪙` : undefined })
    confirmSell.value = null
  } catch {
    sound.play('error')
  } finally {
    sellingId.value[key] = false
  }
}

const confirmSell = ref<{ item: any, qty: number } | null>(null)
function requestSell(item: any, qty: number, ev: MouseEvent) {
  if (qty >= item.quantity) confirmSell.value = { item, qty }
  else doSell(item.id, qty, ev.currentTarget as Element)
}

const sellingKeep = ref<Record<string, boolean>>({})
async function doSellKeep(item: any, ev: MouseEvent) {
  const qty = keepSellQty(item)
  if (qty <= 0) return
  sellingKeep.value[item.id] = true
  const el = ev.currentTarget as Element
  try {
    const res = await colony.sellItem(item.id, qty)
    sound.play('sell')
    fx.celebrate(el, { emoji: ['🪙'], count: 8, text: res?.coins ? `+${formatNumber(res.coins)} 🪙` : undefined })
  } catch {
    sound.play('error')
  } finally {
    sellingKeep.value[item.id] = false
  }
}

const confirmKeepSellAll = ref(false)
const sellingKeepAll = ref(false)
const sellAllBtn = ref<HTMLElement | null>(null)
async function doSellKeepAll() {
  confirmKeepSellAll.value = false
  sellingKeepAll.value = true
  let earned = 0
  try {
    for (const item of keepSellableItems.value) {
      const res = await colony.sellItem(item.id, keepSellQty(item))
      earned += res?.coins ?? 0
      sound.play('coins')
    }
    sound.play('collect-big')
    fx.celebrate(sellAllBtn.value, { emoji: ['🪙', '💰', '✨'], count: 24, text: `+${formatNumber(earned)} 🪙`, flash: true, color: '#f5b342' })
  } catch {
    sound.play('error')
  } finally {
    sellingKeepAll.value = false
  }
}

function onHover() {
  sound.play('hover')
}
function switchTab(t: 'buy' | 'sell') {
  tab.value = t
  sound.play('click')
}
</script>

<template>
  <div class="p-3 md:p-5 w-full space-y-4">
    <!-- ── Stall banner ────────────────────────────────────────────────── -->
    <div class="colony-panel colony-panel-amber p-4 flex flex-col sm:flex-row sm:items-center gap-4 colony-slide-in relative overflow-hidden">
      <div class="colony-shine" />
      <div class="flex items-center gap-3 shrink-0">
        <span class="text-5xl colony-bob">🏪</span>
        <div>
          <p class="colony-eyebrow">
            Bug bazaar
          </p>
          <h1 class="text-2xl colony-title">
            The <span class="colony-amber-text">Market</span>
          </h1>
        </div>
      </div>
      <div class="flex-1" />
      <div class="flex items-center gap-2">
        <button
          class="colony-btn"
          :class="tab === 'buy' ? '' : 'colony-btn-ghost'"
          @click="switchTab('buy')"
          @mouseenter="onHover"
        >
          <UIcon
            name="i-lucide-shopping-basket"
            class="size-4"
          />
          Buy bugs
        </button>
        <button
          class="colony-btn"
          :class="tab === 'sell' ? '' : 'colony-btn-ghost'"
          @click="switchTab('sell')"
          @mouseenter="onHover"
        >
          <UIcon
            name="i-lucide-coins"
            class="size-4"
          />
          Sell loot
          <span
            v-if="totalSellValue > 0"
            class="rounded-full bg-black/25 px-1.5 text-[10px]"
          >{{ formatNumber(totalSellValue) }}</span>
        </button>
      </div>
    </div>

    <!-- ── Buy ─────────────────────────────────────────────────────────── -->
    <template v-if="tab === 'buy'">
      <p class="text-xs text-muted px-1">
        Every bug rolls a <span class="font-bold text-warning">Speed</span> trait and a <span class="font-bold text-info">Yield</span> level within its species' current range (base 0–{{ MAX_TRAIT_PCT }}% / 1–2). Widen the range in the
        <NuxtLink
          to="/colony/research"
          class="text-primary underline font-bold"
        >Lab</NuxtLink>. Bought bugs land in your Bug Box on the Terrarium page.
      </p>

      <div
        v-for="[tier, species] in groupedCatalog"
        :key="tier"
        class="space-y-2"
      >
        <div class="flex items-center gap-2 px-1">
          <span
            class="text-xs font-black rounded-full border px-2 py-0.5"
            :class="[tierColor(tier), tierBg(tier)]"
          >T{{ tier }}</span>
          <span class="text-sm font-black">{{ TIER_NAMES[tier] }}</span>
          <span
            v-if="tier > habitatLevel"
            class="colony-chip colony-chip-bad"
          >
            <UIcon
              name="i-lucide-lock"
              class="size-3"
            />
            Habitat Lv {{ tier }} required
          </span>
          <div class="colony-divider flex-1" />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <div
            v-for="(s, idx) in species"
            :key="s.id"
            class="colony-card colony-slide-in"
            :class="[!s.buyable ? 'colony-card-locked' : '', lastBought?.id === s.id ? 'colony-levelup ring-2 ring-amber-400/60' : '']"
            :style="{ animationDelay: `${idx * 60}ms` }"
          >
            <span
              v-if="!s.buyable"
              class="colony-ribbon colony-ribbon-locked"
            >Locked</span>
            <span
              v-else-if="s.producesGems"
              class="colony-ribbon"
              style="background:#38bdf8;color:white"
            >Gems</span>
            <span
              v-else-if="s.owned === 0"
              class="colony-ribbon colony-ribbon-busy"
            >New</span>

            <div class="p-3.5 space-y-3">
              <div class="flex items-start gap-3">
                <div
                  class="relative size-16 shrink-0 rounded-2xl border flex items-center justify-center text-4xl shadow-inner overflow-hidden"
                  :class="tierBg(s.tier)"
                >
                  <div class="absolute inset-x-0 bottom-0 h-1/3 bg-black/20" />
                  <span
                    class="relative"
                    :class="s.buyable ? 'colony-bob drop-shadow-lg' : 'grayscale opacity-50'"
                  >{{ s.buyable ? s.emoji : '❔' }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-black text-sm truncate">
                    {{ s.buyable ? s.name : 'Unknown species' }}
                  </p>
                  <div
                    v-if="s.buyable"
                    class="flex flex-wrap gap-1 mt-1"
                  >
                    <span
                      class="colony-chip"
                      :class="s.social ? 'colony-chip-ok' : 'colony-chip-amber'"
                    >{{ s.social ? '👥 Social' : '🧍 Solitary' }}</span>
                    <span
                      v-if="s.researchLevel > 0"
                      class="colony-chip"
                      style="color: var(--ui-primary); border-color: color-mix(in srgb, var(--ui-primary) 45%, transparent)"
                    >🧬 Lv {{ s.researchLevel }}</span>
                    <span
                      v-if="s.owned > 0"
                      class="colony-chip"
                    >Owned ×{{ s.owned }}</span>
                  </div>
                  <p class="text-[11px] text-muted mt-1.5 italic line-clamp-2">
                    {{ s.buyable ? s.description : `Reach Habitat Level ${s.tier} to reveal this species.` }}
                  </p>
                </div>
              </div>

              <div
                v-if="s.buyable"
                class="grid grid-cols-2 gap-1.5"
              >
                <div class="rounded-xl bg-black/15 border border-default/60 p-2">
                  <p class="colony-eyebrow">
                    Cycle
                  </p>
                  <p class="text-xs font-black mt-0.5 flex items-center gap-1">
                    <UIcon
                      name="i-lucide-timer"
                      class="size-3 text-warning"
                    />
                    {{ formatDuration(s.baseTickMs) }}
                  </p>
                </div>
                <div class="rounded-xl bg-black/15 border border-default/60 p-2">
                  <p class="colony-eyebrow">
                    Speed roll
                  </p>
                  <p class="text-xs font-black mt-0.5 flex items-center gap-1">
                    <UIcon
                      name="i-lucide-zap"
                      class="size-3 text-warning"
                    />
                    {{ s.producesGems ? 'Fixed' : `${s.speedMin}–${s.speedMax}%` }}
                  </p>
                </div>
                <div class="rounded-xl bg-black/15 border border-default/60 p-2">
                  <p class="colony-eyebrow">
                    Output
                  </p>
                  <p class="text-xs font-black mt-0.5 flex items-center gap-1">
                    <UIcon
                      :name="s.producesGems ? 'i-lucide-gem' : 'i-lucide-package-plus'"
                      class="size-3 text-info"
                    />
                    {{ s.producesGems ? `1–${MAX_GEMS_PER_DAY} 💎/day` : `Yield ${s.yieldMin}–${s.yieldMax} · ×${s.resourceMultiplier}` }}
                  </p>
                </div>
                <div class="rounded-xl bg-black/15 border border-default/60 p-2">
                  <p class="colony-eyebrow">
                    Appetite
                  </p>
                  <p class="text-xs font-black mt-0.5 flex items-center gap-1">
                    <UIcon
                      name="i-lucide-utensils"
                      class="size-3 text-success"
                    />
                    {{ s.eatMin }}–{{ s.eatMax }} / cycle
                  </p>
                </div>
              </div>

              <div
                v-if="s.buyable"
                class="space-y-1 text-xs"
              >
                <div class="flex items-center justify-between gap-3">
                  <span class="text-muted font-bold">Forages</span>
                  <span class="font-bold truncate">{{ s.itemEmoji }} {{ s.itemName }}</span>
                </div>
                <div
                  v-if="!s.producesGems"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="text-muted font-bold">Avg. income</span>
                  <span class="font-mono font-black colony-amber-text">≈ {{ formatNumber(estCoinsPerHour(s)) }} / h</span>
                </div>
                <div
                  v-if="paybackDays(s) !== null"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="text-muted font-bold">Pays for itself in</span>
                  <span class="font-mono">~{{ paybackDays(s)!.toFixed(1) }} days</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span class="text-muted font-bold">Baseline appetite</span>
                  <span class="font-mono">~{{ formatNumber(Math.round(baseFeedPerHour(s)), false) }}/hr</span>
                </div>
              </div>

              <div
                v-if="lastBought && lastBought.id === s.id"
                class="rounded-xl border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5 text-xs font-black text-center colony-slide-in"
              >
                🎉 Rolled ⚡ {{ lastBought.speed }}% · 💎 {{ lastBought.yield }} · 🍽️ {{ lastBought.eat }}
              </div>
            </div>

            <div class="colony-divider" />
            <div class="p-3.5">
              <button
                v-if="s.buyable"
                class="colony-btn colony-btn-block"
                :class="balance >= s.spawnCost ? '' : 'colony-btn-ghost'"
                :disabled="balance < s.spawnCost || buyingId === s.id"
                @click="handleBuy(s, $event)"
                @mouseenter="onHover"
              >
                <UIcon
                  name="i-lucide-shopping-basket"
                  class="size-4"
                />
                <span class="flex items-center gap-1">
                  Buy · <CoinBalance
                    :value="s.spawnCost"
                    :show-icon="false"
                  /> 🪙
                </span>
              </button>
              <NuxtLink
                v-else
                to="/colony/habitat"
                class="colony-btn colony-btn-ghost colony-btn-block"
              >
                <UIcon
                  name="i-lucide-lock"
                  class="size-4"
                />
                Requires Habitat {{ s.tier }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Sell ────────────────────────────────────────────────────────── -->
    <template v-if="tab === 'sell'">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div class="colony-stat sm:col-span-1">
          <span class="colony-eyebrow">Stash worth</span>
          <span class="colony-stat-value colony-amber-text flex items-center gap-1">
            <CoinBalance
              :value="totalSellValue"
              :compact="false"
              :show-icon="false"
            /> 🪙
          </span>
        </div>
        <div class="colony-stat">
          <span class="colony-eyebrow">Stacks</span>
          <span class="colony-stat-value">{{ sellableItems.length }}<span class="text-xs text-muted font-bold"> / {{ inventory.length }}</span></span>
        </div>
        <div class="colony-stat">
          <span class="colony-eyebrow">Tip</span>
          <span class="text-xs text-muted font-bold">Habitat upgrades eat items fast — hoard what the next blueprint needs.</span>
        </div>
      </div>

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

      <div class="colony-panel flex items-center gap-3 px-4 py-2.5 flex-wrap">
        <span class="text-lg">⚖️</span>
        <span class="text-xs text-muted font-bold shrink-0">Keep per stack</span>
        <UInput
          v-model="keepInput"
          type="number"
          min="0"
          size="xs"
          class="w-20"
        />
        <div class="flex-1" />
        <span
          v-if="keepSellTotalValue > 0"
          class="colony-chip colony-chip-amber"
        >
          +{{ formatNumber(keepSellTotalValue) }} 🪙
        </span>
        <button
          ref="sellAllBtn"
          class="colony-btn colony-btn-danger colony-btn-sm"
          :disabled="keepSellableItems.length === 0 || sellingKeepAll"
          @click="confirmKeepSellAll = true"
          @mouseenter="onHover"
        >
          <UIcon
            name="i-lucide-trending-down"
            class="size-3.5"
          />
          Sell all — keep {{ keepAmount }}
        </button>
      </div>

      <div class="space-y-2">
        <div
          v-if="!filteredSellItems.length"
          class="text-sm text-muted py-12 text-center"
        >
          <span class="text-4xl block mb-2 opacity-60">🕸️</span>
          No items match your filter.
        </div>

        <div
          v-for="(item, idx) in filteredSellItems"
          :key="item.id"
          class="colony-card colony-slide-in px-3 py-2.5 flex items-center gap-3"
          :class="[item.quantity <= 0 && 'opacity-40 grayscale']"
          :style="{ animationDelay: `${idx * 30}ms` }"
        >
          <div
            class="size-12 shrink-0 rounded-xl border flex items-center justify-center text-2xl"
            :class="tierBg(item.tier)"
          >
            <span class="drop-shadow">{{ item.emoji }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-black text-sm flex items-center gap-1.5 truncate">
              {{ item.name }}
              <span
                class="text-[10px] font-black"
                :class="tierColor(item.tier)"
              >T{{ item.tier }}</span>
            </p>
            <p class="text-xs text-muted flex items-center gap-1">
              <span class="font-black text-primary tabular-nums">×{{ formatNumber(item.quantity, false) }}</span>
              · <CoinBalance
                :value="item.sellValue"
                :compact="false"
                :show-icon="false"
              /> 🪙 each
            </p>
          </div>
          <div class="text-right shrink-0 hidden sm:block">
            <p class="colony-eyebrow">
              Total
            </p>
            <CoinBalance
              :value="item.quantity * item.sellValue"
              :compact="false"
              class="text-sm font-black justify-end"
            />
          </div>
          <div class="flex gap-1 shrink-0">
            <button
              v-for="qty in [1, 10, 50]"
              :key="qty"
              class="colony-btn colony-btn-danger colony-btn-sm"
              :disabled="item.quantity === 0 || sellingId[`${item.id}-${Math.min(qty, item.quantity)}`]"
              @click="requestSell(item, Math.min(qty, item.quantity), $event)"
              @mouseenter="onHover"
            >
              ×{{ qty }}
            </button>
            <button
              class="colony-btn colony-btn-danger colony-btn-sm"
              :disabled="keepSellQty(item) === 0 || sellingKeep[item.id]"
              :title="`Sell everything but ${keepAmount}`"
              @click="doSellKeep(item, $event)"
              @mouseenter="onHover"
            >
              −{{ keepAmount }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Confirm sell-all stack modal -->
    <UModal
      :open="!!confirmSell"
      title="Sell the whole stack?"
      @update:open="(v) => { if (!v) confirmSell = null }"
    >
      <template #body>
        <div
          v-if="confirmSell"
          class="space-y-4"
        >
          <p class="text-sm text-muted">
            You're about to sell all <span class="font-bold text-default">{{ confirmSell.item.quantity }}× {{ confirmSell.item.name }}</span>.
            This leaves you with <span class="font-bold text-error">0</span> of this stack.
          </p>
          <div class="flex items-center gap-1.5 text-sm font-semibold">
            <span>Total:</span>
            <CoinBalance
              :value="confirmSell.item.quantity * confirmSell.item.sellValue"
              :compact="false"
            />
          </div>
          <div class="flex gap-2 justify-end">
            <button
              class="colony-btn colony-btn-ghost colony-btn-sm"
              @click="confirmSell = null"
            >
              Cancel
            </button>
            <button
              class="colony-btn colony-btn-danger colony-btn-sm"
              :disabled="sellingId[`${confirmSell.item.id}-${confirmSell.item.quantity}`]"
              @click="doSell(confirmSell.item.id, confirmSell.item.quantity)"
            >
              Sell all
            </button>
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
            <button
              class="colony-btn colony-btn-ghost colony-btn-sm"
              @click="confirmKeepSellAll = false"
            >
              Cancel
            </button>
            <button
              class="colony-btn colony-btn-danger colony-btn-sm"
              @click="doSellKeepAll"
            >
              <UIcon
                name="i-lucide-trending-down"
                class="size-3.5"
              />
              Sell — keep {{ keepAmount }}
            </button>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
