<script setup lang="ts">
import { useIntervalFn, useElementSize } from '@vueuse/core'
import { format, formatDistanceToNow } from 'date-fns'
import { gemBuyGems, gemSellGems, GEM_MAX_GEMS_PER_TRADE, GEM_INITIAL_PRICE, gemStepPrice, gemEffectiveGrowthRate } from '#shared/utils/gamelogic/gem-market'

const { data, refresh } = await useFetch('/api/gem-market/state')
const { user, fetchSession } = useAuth()

// Re-fetch market state every 30s
useIntervalFn(() => refresh(), 30_000)

// Tick every second to drive the live price counter
const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 1_000)

// Live price computed client-side between API refreshes.
// Uses gemStepPrice so the formula is identical to the server.
const livePrice = computed(() => {
  if (!data.value) return 0
  const hoursElapsed = (now.value - new Date(data.value.lastUpdatedAt).getTime()) / 3_600_000
  return gemStepPrice(data.value.storedPrice, hoursElapsed)
})

// ---- Change vs base price (all-time) ----
const changeFromBase = computed(() => {
  if (!livePrice.value) return null
  return ((livePrice.value - GEM_INITIAL_PRICE) / GEM_INITIAL_PRICE) * 100
})

// ---- Current growth rate ----
const currentGrowthRate = computed(() => {
  if (!livePrice.value) return 0
  return gemEffectiveGrowthRate(livePrice.value) * 100
})

// ---- 24h change ----
const change24h = computed(() => {
  const history = data.value?.history
  if (!history?.length) return null
  const cutoff = Date.now() - 24 * 3_600_000
  const refEntry = history.find(h => new Date(h.createdAt).getTime() <= cutoff)
      ?? history[history.length - 1]!
  const ref = parseFloat(refEntry.price)
  if (!ref) return null
  return ((livePrice.value - ref) / ref) * 100
})

// ---- Chart ----
type PricePoint = { date: Date; price: number }

const chartRef = useTemplateRef<HTMLElement>('chartRef')
const { width: chartWidth } = useElementSize(chartRef)

const chartView = ref<'7d' | '30d'>('30d')

const chartData = computed((): PricePoint[] => {
  const history = data.value?.history
  const windowMs = chartView.value === '7d' ? 7 * 24 * 3_600_000 : 30 * 24 * 3_600_000
  const cutoff = Date.now() - windowMs

  if (!history?.length) return [{ date: new Date(cutoff), price: livePrice.value }, { date: new Date(now.value), price: livePrice.value }]

  const allEvents: PricePoint[] = [...history]
      .reverse()
      .map(h => ({ date: new Date(h.createdAt), price: parseFloat(h.price) }))

  allEvents.push({ date: new Date(now.value), price: livePrice.value })

  // Find start anchor: last event before the cutoff, or first event
  const firstInWindow = allEvents.findIndex(e => e.date.getTime() >= cutoff)
  const startIdx = firstInWindow > 0 ? firstInWindow - 1 : 0
  const events = allEvents.slice(startIdx)

  const points: PricePoint[] = []
  const STEPS = 24

  for (let i = 0; i < events.length - 1; i++) {
    const from = events[i]!
    const to = events[i + 1]!
    const spanMs = to.date.getTime() - from.date.getTime()
    if (spanMs <= 0) continue

    for (let s = 0; s <= STEPS; s++) {
      const t = from.date.getTime() + (spanMs * s / STEPS)
      const hoursElapsed = (t - from.date.getTime()) / 3_600_000
      points.push({ date: new Date(t), price: gemStepPrice(from.price, hoursElapsed) })
    }

    if (i < events.length - 2) {
      points.push({ date: to.date, price: to.price })
    }
  }

  points.push({ date: new Date(now.value), price: livePrice.value })

  return points
})

const xFn = (_: PricePoint, i: number) => i
const yFn = (d: PricePoint) => d.price

const xTickFmt = (i: number) => {
  const pts = chartData.value
  const len = pts.length
  if (len < 2) return ''
  // unovis may pass fractional tick positions — round to nearest data index
  const idx = Math.round(i)
  const step = Math.floor(len / 5)
  if (step < 1 || idx % step !== 0) return ''
  const pt = pts[idx]
  if (!pt) return ''
  // 7d/30d views always span multiple days — show date
  return format(pt.date, 'MMM d')
}

const tooltipFmt = (d: PricePoint) =>
    `<div style="font-weight:700;font-size:1rem">$${formatNumber(d.price, false)}</div>` +
    `<div style="font-size:0.7rem;opacity:0.6;margin-top:2px">${format(d.date, 'MMM d, HH:mm:ss')}</div>`

const priceUp = computed(() => (change24h.value ?? 0) >= 0)
const lineColor = computed(() => priceUp.value ? 'var(--ui-success)' : 'var(--ui-error)')

// ---- Trade panel ----
const tradeMode = ref<'buy' | 'sell'>('buy')
const amount = ref(1)
const loading = ref(false)
const toast = useToast()

const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const userGems = computed(() => user.value?.gems ?? 0)

// Actual cost/revenue using the exponential curve + fee
const tradeResult = computed(() => {
  const a = Math.max(1, Math.min(amount.value || 1, GEM_MAX_GEMS_PER_TRADE))
  if (tradeMode.value === 'buy') {
    const { cost, newPrice } = gemBuyGems(livePrice.value, a)
    return { total: cost, newPrice }
  }
  const { revenue, newPrice } = gemSellGems(livePrice.value, a)
  return { total: revenue, newPrice }
})

const canBuy = computed(() => balance.value >= tradeResult.value.total && amount.value >= 1)
const canSell = computed(() => userGems.value >= amount.value && amount.value >= 1)

// Portfolio = what you'd actually receive selling all gems
const portfolioValue = computed(() => {
  if (userGems.value <= 0) return 0
  return gemSellGems(livePrice.value, userGems.value).revenue
})

// Price impact preview
const priceImpactPct = computed(() => {
  const cur = livePrice.value
  if (!cur) return 0
  return ((tradeResult.value.newPrice - cur) / cur) * 100
})

async function executeTrade() {
  if (loading.value) return
  loading.value = true
  try {
    const endpoint = tradeMode.value === 'buy' ? '/api/gem-market/buy' : '/api/gem-market/sell'
    const tradeAmount = amount.value
    const tradeValue = tradeResult.value.total
    await $fetch(endpoint, { method: 'POST', body: { gems: tradeAmount } })
    await Promise.all([refresh(), fetchSession()])
    const isBuy = tradeMode.value === 'buy'
    const gemLabel = `${tradeAmount} gem${tradeAmount !== 1 ? 's' : ''}`
    const title = isBuy
        ? `Bought ${gemLabel} for $${formatNumber(tradeValue, false)}`
        : `Sold ${gemLabel} for $${formatNumber(tradeValue, false)}`
    toast.add({ title, color: 'success' })
  } catch (e: any) {
    toast.add({ title: apiErrorMessage(e, 'Trade failed'), color: 'error' })
  } finally {
    loading.value = false
  }
}

// ---- Misc ----
const mounted = ref(false)
onMounted(() => setTimeout(() => { mounted.value = true }, 50))

function actionIcon(action: string) {
  if (action === 'buy') return 'i-lucide-trending-up'
  if (action === 'sell') return 'i-lucide-trending-down'
  return 'i-lucide-zap'
}
function actionColor(action: string) {
  if (action === 'buy') return 'text-success'
  if (action === 'sell') return 'text-error'
  return 'text-primary'
}
function actionBg(action: string) {
  if (action === 'buy') return 'bg-success/15'
  if (action === 'sell') return 'bg-error/15'
  return 'bg-primary/15'
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold flex items-center gap-2">
          <UIcon name="i-lucide-gem" class="size-6 text-cyan-400" />
          Gem Market
        </h1>
        <p class="text-sm text-muted mt-0.5">
          Price rises over time — selling crashes it, buying pumps it.
        </p>
      </div>
      <div class="flex items-center gap-3">
        <div class="text-right">
          <p class="text-xs text-muted uppercase tracking-wide">Current Price</p>
          <p class="text-3xl font-bold tabular-nums" :class="priceUp ? 'text-success' : 'text-error'">
            ${{ formatNumber(livePrice, false) }}
          </p>
        </div>
        <div
            v-if="changeFromBase !== null"
            class="px-3 py-1.5 rounded-lg text-sm font-semibold tabular-nums"
            :class="priceUp ? 'bg-success/15 text-success' : 'bg-error/15 text-error'"
        >
          {{ priceUp ? '+' : '' }}{{ changeFromBase.toFixed(2) }}%
          <span class="text-xs font-normal opacity-70 ml-1">vs base</span>
        </div>
      </div>
    </div>

    <!-- Stat cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <UCard class="ring-1 ring-cyan-500/20 bg-cyan-500/5">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">Live Price</p>
            <p class="text-xl font-bold text-cyan-400 mt-1 tabular-nums">${{ formatNumber(livePrice, false) }}</p>
            <UTooltip :delay-duration="120" text="The higher the price is above base price the slower the growth is and the lower the faster">
              <p class="text-xs text-muted mt-0.5 tabular-nums cursor-help inline-block border-b border-dashed border-muted/50">
                +{{ currentGrowthRate.toFixed(3) }}%/hr
              </p>
            </UTooltip>
          </div>
          <div class="size-9 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-gem" class="size-4 text-cyan-400" />
          </div>
        </div>
      </UCard>

      <UCard :class="['ring-1', priceUp ? 'ring-success/20 bg-success/5' : 'ring-error/20 bg-error/5']">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">24h Change</p>
            <p
                class="text-xl font-bold mt-1 tabular-nums"
                :class="priceUp ? 'text-success' : 'text-error'"
            >
              {{ change24h !== null ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%` : '—' }}
            </p>
          </div>
          <div class="size-9 rounded-lg flex items-center justify-center shrink-0" :class="priceUp ? 'bg-success/15' : 'bg-error/15'">
            <UIcon :name="priceUp ? 'i-lucide-trending-up' : 'i-lucide-trending-down'" class="size-4" :class="priceUp ? 'text-success' : 'text-error'" />
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">Base Price</p>
            <p class="text-xl font-bold mt-1 tabular-nums">${{ formatNumber(data?.initialPrice ?? 0, false) }}</p>
          </div>
          <div class="size-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-anchor" class="size-4 text-primary" />
          </div>
        </div>
      </UCard>

      <UCard>
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-muted font-medium uppercase tracking-wide">Portfolio Value</p>
            <p class="text-xl font-bold mt-1 tabular-nums text-cyan-400">${{ formatNumber(portfolioValue, false) }}</p>
            <p class="text-xs text-muted mt-0.5 tabular-nums">{{ formatNumber(userGems) }} gems</p>
          </div>
          <div class="size-9 rounded-lg bg-cyan-500/15 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-wallet" class="size-4 text-cyan-400" />
          </div>
        </div>
      </UCard>
    </div>

    <!-- Chart + Trade panel -->
    <div class="grid lg:grid-cols-3 gap-6">
      <!-- Price chart -->
      <UCard ref="chartRef" class="lg:col-span-2" :ui="{ body: '!px-0 !pt-0 !pb-3' }">
        <template #header>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs text-muted uppercase tracking-wide mb-0.5">Price History</p>
              <p class="text-xl font-semibold tabular-nums" :class="priceUp ? 'text-success' : 'text-error'">
                ${{ formatNumber(livePrice, false) }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex rounded-md overflow-hidden border border-default text-xs font-semibold">
                <button
                    class="px-2.5 py-1 transition-colors"
                    :class="chartView === '7d' ? 'bg-primary text-white' : 'hover:bg-elevated text-muted'"
                    @click="chartView = '7d'"
                >7d</button>
                <button
                    class="px-2.5 py-1 transition-colors"
                    :class="chartView === '30d' ? 'bg-primary text-white' : 'hover:bg-elevated text-muted'"
                    @click="chartView = '30d'"
                >30d</button>
              </div>
              <UBadge
                  :label="`${data?.history.length ?? 0} trade events`"
                  color="neutral"
                  variant="subtle"
              />
            </div>
          </div>
        </template>

        <ChartsChartLine
            v-if="data && chartData.length >= 2"
            :data="chartData"
            height="h-52"
            :x="xFn"
            :y="yFn"
            :color="lineColor"
            :width="chartWidth"
            :tick-format="xTickFmt"
            :tooltip-template="tooltipFmt"
        />
        <div v-else class="h-52 flex flex-col items-center justify-center gap-2 text-muted">
          <UIcon name="i-lucide-line-chart" class="size-10 opacity-20" />
          <p class="text-sm">Waiting for trade data…</p>
        </div>

      </UCard>

      <!-- Trade panel -->
      <UCard>
        <template #header>
          <h2 class="font-semibold">Trade Gems</h2>
        </template>

        <!-- Buy / Sell toggle -->
        <div class="flex rounded-lg overflow-hidden border border-default mb-5">
          <button
              class="flex-1 py-2 text-sm font-semibold transition-colors"
              :class="tradeMode === 'buy' ? 'bg-success text-white' : 'hover:bg-elevated text-muted'"
              @click="tradeMode = 'buy'"
          >
            Buy
          </button>
          <button
              class="flex-1 py-2 text-sm font-semibold transition-colors"
              :class="tradeMode === 'sell' ? 'bg-error text-white' : 'hover:bg-elevated text-muted'"
              @click="tradeMode = 'sell'"
          >
            Sell
          </button>
        </div>

        <!-- Amount -->
        <div class="space-y-4">
          <div>
            <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">
              Amount (gems)
            </label>
            <UInput
                v-model="amount"
                type="number"
                min="1"
                :max="GEM_MAX_GEMS_PER_TRADE"
                placeholder="1"
                class="w-full"
            />
            <p class="text-xs text-muted mt-1">Max {{ GEM_MAX_GEMS_PER_TRADE }} per trade</p>
          </div>

          <!-- Cost / Revenue preview -->
          <div class="rounded-lg bg-elevated border border-default p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Spot price</span>
              <span class="font-medium tabular-nums">${{ formatNumber(livePrice, false) }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ tradeMode === 'buy' ? 'Total cost' : 'You receive' }}</span>
              <span
                  class="font-bold tabular-nums"
                  :class="tradeMode === 'buy' ? 'text-error' : 'text-success'"
              >
                {{ tradeMode === 'buy' ? '-' : '+' }}${{ formatNumber(tradeResult.total, false) }}
              </span>
            </div>
            <div class="flex items-center justify-between text-xs text-muted">
              <span>Price impact</span>
              <span class="tabular-nums" :class="priceImpactPct >= 0 ? 'text-success' : 'text-error'">
                {{ priceImpactPct >= 0 ? '+' : '' }}{{ priceImpactPct.toFixed(2) }}%
              </span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-xs text-muted">
              <span>Your balance</span>
              <span class="tabular-nums"><CoinBalance :compact="false" :value="balance"/></span>
            </div>
            <div class="flex items-center justify-between text-xs text-muted">
              <span>Your gems</span>
              <span class="tabular-nums"><GemBalance :value="userGems"/></span>
            </div>
          </div>

          <!-- Impact hint -->
          <p class="text-xs text-muted">
            Includes 0.5% fee. Larger trades move the price more — the cost/revenue accounts for the price shifting during the trade.
          </p>

          <UButton
              block
              :color="tradeMode === 'buy' ? 'success' : 'error'"
              :label="tradeMode === 'buy' ? `Buy ${amount} gem${amount !== 1 ? 's' : ''}` : `Sell ${amount} gem${amount !== 1 ? 's' : ''}`"
              :loading="loading"
              :disabled="tradeMode === 'buy' ? !canBuy : !canSell"
              @click="executeTrade"
          />
        </div>
      </UCard>
    </div>

    <!-- Recent trades -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Recent Trades</h2>
          <UBadge :label="`${data?.history.length ?? 0} events`" color="neutral" variant="subtle" />
        </div>
      </template>

      <div
          v-if="!data?.history.length"
          class="py-12 flex flex-col items-center gap-2 text-muted"
      >
        <UIcon name="i-lucide-activity" class="size-10 opacity-20" />
        <p class="text-sm">No trades yet — be the first!</p>
      </div>

      <UScrollArea v-else class="max-h-80 -mx-4 -mb-4">
        <div class="divide-y divide-default">
          <div
              v-for="(entry, i) in data.history"
              :key="i"
              class="flex items-center gap-3 px-4 py-3 hover:bg-elevated/50 transition-colors"
          >
            <div class="size-8 rounded-full flex items-center justify-center shrink-0" :class="actionBg(entry.action)">
              <UIcon :name="actionIcon(entry.action)" class="size-4" :class="actionColor(entry.action)" />
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-semibold">{{ entry.userName ?? 'System' }}</span>
                <UBadge
                    :label="entry.action"
                    :color="entry.action === 'buy' ? 'success' : entry.action === 'sell' ? 'error' : 'neutral'"
                    variant="subtle"
                    size="sm"
                />
                <UBadge
                    v-if="entry.gems > 0"
                    :label="`${entry.gems} gem${entry.gems !== 1 ? 's' : ''}`"
                    color="neutral"
                    variant="outline"
                    size="sm"
                />
              </div>
              <p class="text-xs text-muted mt-0.5">
                {{ formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) }}
              </p>
              <p class="text-xs text-muted/60">
                {{ format(new Date(entry.createdAt), 'MMM d, yyyy · HH:mm:ss') }}
              </p>
            </div>

            <div class="text-right">
              <p
                  v-if="parseFloat(entry.totalAmount) > 0"
                  class="text-sm font-bold tabular-nums"
                  :class="entry.action === 'buy' ? 'text-error' : 'text-success'"
              >
                {{ entry.action === 'buy' ? '-' : '+' }}${{ formatNumber(parseFloat(entry.totalAmount), false) }}
              </p>
              <p class="text-xs text-muted tabular-nums">@ ${{ formatNumber(parseFloat(entry.price), false) }}</p>
            </div>
          </div>
        </div>
      </UScrollArea>
    </UCard>
  </div>
</template>

<style scoped>
.unovis-xy-container {
  --vis-crosshair-line-stroke-color: v-bind(lineColor);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);

  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
}
</style>
