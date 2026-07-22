<script setup lang="ts">
import { useIntervalFn, useElementSize, useDebounceFn } from '@vueuse/core'
import { format, formatDistance } from 'date-fns'
import {
  GEM_EXCHANGE_MAX_QUANTITY,
  GEM_EXCHANGE_MIN_PRICE,
  gemOrderTotal,
  getGemBookLevelOrder
} from '#shared/utils/gamelogic/gem-exchange'

const { data, refresh } = await useFetch('/api/gem-exchange/state')
const { user, fetchSession } = useAuth()
const toast = useToast()

// Live updates arrive over the websocket; the slow poll is only a fallback
// for when the socket is down or a broadcast is missed.
useIntervalFn(() => refresh(), 30_000)

// ---- Websocket: the server pings on every book change, we refetch ----------
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let unmounted = false

// A burst of fills sends many pings — collapse them into one refetch.
const liveRefresh = useDebounceFn(() => {
  refresh()
  fetchSession()
}, 250)

function connect() {
  if (unmounted || ws) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/api/gem-exchange/ws`)
  ws.onmessage = () => liveRefresh()
  ws.onclose = () => {
    ws = null
    if (!unmounted) reconnectTimer = setTimeout(connect, 3000)
  }
}

onMounted(connect)
onUnmounted(() => {
  unmounted = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  ws?.close()
})

// Relative timestamps are rendered against a "now" captured once on the server
// and shipped in the payload, so SSR and hydration produce identical strings.
// After mount it snaps to the real clock and keeps ticking.
const now = useState('gem-exchange-now', () => Date.now())
onMounted(() => { now.value = Date.now() })
useIntervalFn(() => { now.value = Date.now() }, 30_000)

function timeAgo(date: string | Date) {
  return formatDistance(new Date(date), new Date(now.value), { addSuffix: true })
}

const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const userGems = computed(() => user.value?.gems ?? 0)

const guidePrice = computed(() => data.value?.guidePrice ?? 0)
const lastPrice = computed(() => data.value?.lastPrice ?? null)
const change24h = computed(() => data.value?.change24h ?? null)
const priceUp = computed(() => (change24h.value ?? 0) >= 0)

const spread = computed(() => {
  const bid = data.value?.bestBid
  const ask = data.value?.bestAsk
  if (bid == null || ask == null) return null
  return ask - bid
})

// ---- Trade terminal ----
const tradeMode = ref<'buy' | 'sell'>('buy')
const quantity = ref(1)
const price = ref(0)
const loading = ref(false)
const priceTouched = ref(false)
const tradeTerminal = useTemplateRef<HTMLElement>('tradeTerminal')

function round2(value: number) {
  return Math.round(value * 100) / 100
}

// Smart default: buying starts at the cheapest sell offer, selling at the
// highest buy offer — the price that trades right now. Guide when book empty.
const defaultPrice = computed(() => {
  const smart = tradeMode.value === 'buy' ? data.value?.bestAsk : data.value?.bestBid
  return round2(smart ?? guidePrice.value)
})

// Follow the smart default until the user edits the price themselves.
watchEffect(() => {
  if (!priceTouched.value && defaultPrice.value > 0) price.value = defaultPrice.value
})

function setTradeMode(mode: 'buy' | 'sell') {
  if (tradeMode.value === mode) return
  tradeMode.value = mode
  priceTouched.value = false
}

function bookLevelOrder(restingSide: 'buy' | 'sell', index: number) {
  const levels = restingSide === 'sell' ? (data.value?.book.asks ?? []) : (data.value?.book.bids ?? [])
  return getGemBookLevelOrder(restingSide, levels, index)
}

function selectBookLevel(restingSide: 'buy' | 'sell', index: number) {
  const order = bookLevelOrder(restingSide, index)
  if (!order) return

  tradeMode.value = order.side
  priceTouched.value = true
  price.value = order.price
  setQuantity(order.quantity)
  nextTick(() => tradeTerminal.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function bookLevelLabel(restingSide: 'buy' | 'sell', index: number) {
  const order = bookLevelOrder(restingSide, index)
  if (!order) return undefined
  const action = order.side === 'buy' ? 'Buy' : 'Sell'
  return `${action} ${formatNumber(order.quantity, false)} gems through ${formatNumber(order.price, false)} coins each`
}

function nudgePrice(pct: number) {
  priceTouched.value = true
  price.value = round2(Math.max(GEM_EXCHANGE_MIN_PRICE, price.value + defaultPrice.value * pct))
}

function resetPrice() {
  priceTouched.value = false
}

function setQuantity(amount: number) {
  quantity.value = Math.max(1, Math.min(GEM_EXCHANGE_MAX_QUANTITY, Math.floor(amount)))
}

const maxAffordable = computed(() => {
  if (tradeMode.value === 'sell') return userGems.value
  if (price.value < GEM_EXCHANGE_MIN_PRICE) return 0
  return Math.floor(balance.value / price.value)
})

const priceVsGuide = computed(() => {
  if (!guidePrice.value) return 0
  return ((price.value - guidePrice.value) / guidePrice.value) * 100
})

const safeQuantity = computed(() => Math.max(1, Math.min(Math.floor(quantity.value || 1), GEM_EXCHANGE_MAX_QUANTITY)))
const safePrice = computed(() => round2(Math.max(GEM_EXCHANGE_MIN_PRICE, price.value || 0)))
const orderTotal = computed(() => gemOrderTotal(safePrice.value, safeQuantity.value))

// Preview the fill: walk the visible book levels the order would cross and
// split the quantity into what trades instantly vs what rests as an offer.
// Fills happen at the resting price, so the instant part can cost less than
// the escrowed total — that difference comes back as change.
const fillPreview = computed(() => {
  const levels = tradeMode.value === 'buy' ? (data.value?.book.asks ?? []) : (data.value?.book.bids ?? [])
  let instant = 0
  let cost = 0
  for (const level of levels) {
    const crosses = tradeMode.value === 'buy' ? safePrice.value >= level.price : safePrice.value <= level.price
    if (!crosses || instant >= safeQuantity.value) break
    const take = Math.min(level.quantity, safeQuantity.value - instant)
    instant += take
    cost += gemOrderTotal(level.price, take)
  }
  // Buy: escrow minus real cost comes back. Sell: higher bids pay extra.
  const atLimit = gemOrderTotal(safePrice.value, instant)
  const bonus = round2(tradeMode.value === 'buy' ? atLimit - cost : cost - atLimit)
  return { instant, rest: safeQuantity.value - instant, cost, bonus }
})

const canSubmit = computed(() => {
  if (!user.value || loading.value) return false
  if (quantity.value < 1 || price.value < GEM_EXCHANGE_MIN_PRICE) return false
  if (tradeMode.value === 'buy') return balance.value >= orderTotal.value
  return userGems.value >= safeQuantity.value
})

async function placeOrder() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await $fetch('/api/gem-exchange/place', {
      method: 'POST',
      body: { side: tradeMode.value, quantity: safeQuantity.value, price: safePrice.value }
    })
    await Promise.all([refresh(), fetchSession()])

    const gemLabel = (n: number) => `${formatNumber(n, false)} gem${n !== 1 ? 's' : ''}`
    if (result.filled === 0) {
      toast.add({
        title: `${result.side === 'buy' ? 'Buy' : 'Sell'} offer placed`,
        description: `${gemLabel(result.quantity)} @ ${formatNumber(result.price, false)} coins — waiting for a match`,
        color: 'info'
      })
    } else {
      const avg = result.avgFillPrice ?? result.price
      const title = result.side === 'buy'
          ? `Bought ${gemLabel(result.filled)} for ${formatNumber(result.coinsMoved, false)} coins`
          : `Sold ${gemLabel(result.filled)} for ${formatNumber(result.coinsMoved, false)} coins`
      toast.add({
        title,
        description: result.remaining > 0
            ? `Avg ${formatNumber(avg, false)} coins — ${gemLabel(result.remaining)} still on offer`
            : `Avg ${formatNumber(avg, false)} coins`,
        color: 'success'
      })
    }
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not place the offer'), color: 'error' })
  } finally {
    loading.value = false
  }
}

const cancelling = ref<string | null>(null)
async function cancelOrder(orderId: string) {
  if (cancelling.value) return
  cancelling.value = orderId
  try {
    await $fetch('/api/gem-exchange/cancel', { method: 'POST', body: { orderId } })
    await Promise.all([refresh(), fetchSession()])
    toast.add({ title: 'Offer cancelled — escrow returned', color: 'neutral' })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not cancel the offer'), color: 'error' })
  } finally {
    cancelling.value = null
  }
}

// ---- Chart ----
type PricePoint = { date: Date, price: number }

const chartRef = useTemplateRef<HTMLElement>('chartRef')
const { width: chartWidth } = useElementSize(chartRef)

const chartView = ref<'24h' | '7d' | '30d'>('7d')
const CHART_WINDOWS = { '24h': 24 * 3_600_000, '7d': 7 * 24 * 3_600_000, '30d': 30 * 24 * 3_600_000 } as const

const chartData = computed((): PricePoint[] => {
  const history = data.value?.history ?? []
  const cutoff = Date.now() - CHART_WINDOWS[chartView.value]

  const inWindow = history.filter(h => new Date(h.createdAt).getTime() >= cutoff)
  // Anchor with the last trade before the window so the line enters from the left edge.
  const anchor = [...history].reverse().find(h => new Date(h.createdAt).getTime() < cutoff)
  const points: PricePoint[] = []
  if (anchor) points.push({ date: new Date(cutoff), price: parseFloat(String(anchor.price)) })
  for (const h of inWindow) points.push({ date: new Date(h.createdAt), price: parseFloat(String(h.price)) })
  // Extend the latest price to "now" so the line always reaches the right edge.
  const latest = points[points.length - 1]
  if (latest) points.push({ date: new Date(), price: latest.price })
  return points
})

const chartUp = computed(() => {
  const pts = chartData.value
  if (pts.length < 2) return true
  return pts[pts.length - 1]!.price >= pts[0]!.price
})
const lineColor = computed(() => chartUp.value ? 'var(--ui-success)' : 'var(--ui-error)')

const xFn = (_: PricePoint, i: number) => i
const yFn = (d: PricePoint) => d.price

const xTickFmt = (i: number) => {
  const pts = chartData.value
  const len = pts.length
  if (len < 2) return ''
  const idx = Math.round(i)
  const step = Math.max(1, Math.floor(len / 5))
  if (idx % step !== 0) return ''
  const pt = pts[idx]
  if (!pt) return ''
  return format(pt.date, chartView.value === '24h' ? 'HH:mm' : 'MMM d')
}

const tooltipFmt = (d: PricePoint) =>
    `<div style="font-weight:700;font-size:1rem">${formatNumber(d.price, false)} coins</div>` +
    `<div style="font-size:0.7rem;opacity:0.6;margin-top:2px">${format(d.date, 'MMM d, HH:mm:ss')}</div>`

// ---- Live offers filter ----
const showMineOnly = ref(false)
const sideFilter = ref<'buy' | 'sell' | null>(null)
function toggleSideFilter(side: 'buy' | 'sell') {
  sideFilter.value = sideFilter.value === side ? null : side
}
const visibleOrders = computed(() => {
  let orders = data.value?.orders ?? []
  if (showMineOnly.value) orders = orders.filter(order => order.mine)
  if (sideFilter.value) orders = orders.filter(order => order.side === sideFilter.value)
  return orders
})

// ---- Recent trades filter ----
const showMineTradesOnly = ref(false)
const visibleTrades = computed(() => {
  const trades = data.value?.trades ?? []
  return showMineTradesOnly.value ? trades.filter(trade => trade.mine) : trades
})

// ---- Order book depth bars ----
const maxBidDepth = computed(() => Math.max(1, ...(data.value?.book.bids ?? []).map(l => l.quantity)))
const maxAskDepth = computed(() => Math.max(1, ...(data.value?.book.asks ?? []).map(l => l.quantity)))
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-gem" class="size-6 text-cyan-400" />
        Gem Exchange
      </h1>
      <p class="text-sm text-muted mt-0.5">
        Player-driven market — every gem bought comes from another player's offer.
      </p>
    </div>

    <!-- Ticker strip -->
    <div class="rounded-xl border border-default bg-elevated/50 overflow-x-auto">
      <div class="flex items-stretch divide-x divide-default min-w-max">
        <div class="px-5 py-3">
          <p class="text-[10px] text-muted uppercase tracking-widest">Guide Price</p>
          <div class="text-lg font-bold tabular-nums text-cyan-400">
            <CoinBalance :value="guidePrice" :compact="false" />
          </div>
        </div>
        <div class="px-5 py-3">
          <p class="text-[10px] text-muted uppercase tracking-widest">Last Trade</p>
          <div class="text-lg font-bold tabular-nums">
            <CoinBalance v-if="lastPrice !== null" :value="lastPrice" :compact="false" />
            <span v-else>—</span>
          </div>
        </div>
        <div class="px-5 py-3">
          <p class="text-[10px] text-muted uppercase tracking-widest">24h Change</p>
          <p class="text-lg font-bold tabular-nums" :class="change24h === null ? '' : priceUp ? 'text-success' : 'text-error'">
            {{ change24h !== null ? `${priceUp ? '+' : ''}${change24h.toFixed(2)}%` : '—' }}
          </p>
        </div>
        <div class="px-5 py-3">
          <p class="text-[10px] text-muted uppercase tracking-widest">Best Buy Offer</p>
          <div class="text-lg font-bold tabular-nums text-success">
            <CoinBalance v-if="data?.bestBid != null" :value="data.bestBid" :compact="false" />
            <span v-else>—</span>
          </div>
        </div>
        <div class="px-5 py-3">
          <p class="text-[10px] text-muted uppercase tracking-widest">Best Sell Offer</p>
          <div class="text-lg font-bold tabular-nums text-error">
            <CoinBalance v-if="data?.bestAsk != null" :value="data.bestAsk" :compact="false" />
            <span v-else>—</span>
          </div>
        </div>
        <div class="px-5 py-3">
          <p class="text-[10px] text-muted uppercase tracking-widest">Spread</p>
          <div class="text-lg font-bold tabular-nums">
            <CoinBalance v-if="spread !== null" :value="spread" :compact="false" />
            <span v-else>—</span>
          </div>
        </div>
        <div class="px-5 py-3">
          <p class="text-[10px] text-muted uppercase tracking-widest">Gems for Sale</p>
          <p class="text-lg font-bold tabular-nums text-cyan-400">
            {{ formatNumber(data?.gemsForSale ?? 0) }}
          </p>
        </div>
        <div class="px-5 py-3">
          <p class="text-[10px] text-muted uppercase tracking-widest">24h Volume</p>
          <p class="text-lg font-bold tabular-nums">
            {{ formatNumber(data?.stats24h.volumeGems ?? 0) }} <span class="text-xs font-normal text-muted">gems</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Trade terminal (primary) -->
    <div
        ref="tradeTerminal"
        class="scroll-mt-4 rounded-xl border p-5 sm:p-6 transition-colors"
        :class="tradeMode === 'buy'
          ? 'border-success/30 bg-gradient-to-br from-success/8 via-transparent to-cyan-500/5'
          : 'border-error/30 bg-gradient-to-br from-error/8 via-transparent to-cyan-500/5'"
    >
      <div class="grid lg:grid-cols-5 gap-6">
        <!-- Inputs -->
        <div class="lg:col-span-3 space-y-5">
          <!-- Mode toggle -->
          <div class="grid grid-cols-2 gap-3">
            <button
                class="rounded-xl border-2 py-3.5 flex items-center justify-center gap-2 font-bold text-base transition-all"
                :class="tradeMode === 'buy'
                  ? 'border-success bg-success text-white shadow-lg shadow-success/25'
                  : 'border-default text-muted hover:border-success/50 hover:text-success'"
                @click="setTradeMode('buy')"
            >
              <UIcon name="i-lucide-trending-up" class="size-5" />
              Buy Gems
            </button>
            <button
                class="rounded-xl border-2 py-3.5 flex items-center justify-center gap-2 font-bold text-base transition-all"
                :class="tradeMode === 'sell'
                  ? 'border-error bg-error text-white shadow-lg shadow-error/25'
                  : 'border-default text-muted hover:border-error/50 hover:text-error'"
                @click="setTradeMode('sell')"
            >
              <UIcon name="i-lucide-trending-down" class="size-5" />
              Sell Gems
            </button>
          </div>

          <div class="grid sm:grid-cols-2 gap-4">
            <!-- Quantity -->
            <div>
              <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">
                Quantity
              </label>
              <div class="flex items-center gap-1.5">
                <UButton
                    size="xl"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-minus"
                    square
                    :disabled="safeQuantity <= 1"
                    @click="setQuantity(quantity - 1)"
                />
                <UInput
                    v-model="quantity"
                    type="number"
                    min="1"
                    size="xl"
                    placeholder="1"
                    class="w-full"
                >
                  <template #leading>
                    <UIcon name="i-lucide-gem" class="size-4 text-cyan-400" />
                  </template>
                </UInput>
                <UButton
                    size="xl"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-plus"
                    square
                    @click="setQuantity(quantity + 1)"
                />
              </div>
              <div class="flex gap-1.5 mt-2">
                <UButton size="xs" color="neutral" variant="soft" label="+1" @click="setQuantity(quantity + 1)" />
                <UButton size="xs" color="neutral" variant="soft" label="+10" @click="setQuantity(quantity + 10)" />
                <UButton size="xs" color="neutral" variant="soft" label="+100" @click="setQuantity(quantity + 100)" />
                <UButton
                    size="xs"
                    color="neutral"
                    variant="soft"
                    label="Max"
                    :disabled="maxAffordable < 1"
                    @click="setQuantity(maxAffordable)"
                />
              </div>
            </div>

            <!-- Price -->
            <div>
              <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">
                Price per gem
              </label>
              <UInput
                  v-model="price"
                  type="number"
                  :min="GEM_EXCHANGE_MIN_PRICE"
                  step="0.01"
                  size="xl"
                  class="w-full"
                  @input="priceTouched = true"
              >
                <template #leading>
                  <UIcon name="i-lucide-coins" class="size-4 text-yellow-400" />
                </template>
              </UInput>
              <div class="flex items-center gap-1.5 mt-2">
                <UButton size="xs" color="error" variant="soft" label="-20%" @click="nudgePrice(-0.20)" />
                <UButton size="xs" color="error" variant="soft" label="-5%" @click="nudgePrice(-0.05)" />
                <UTooltip :text="tradeMode === 'buy' ? 'Reset to the cheapest sell offer' : 'Reset to the highest buy offer'" :delay-duration="120">
                  <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-rotate-ccw" @click="resetPrice" />
                </UTooltip>
                <UButton size="xs" color="success" variant="soft" label="+5%" @click="nudgePrice(0.05)" />
                <UButton size="xs" color="success" variant="soft" label="+20%" @click="nudgePrice(0.20)" />
              </div>
            </div>
          </div>

          <p class="text-xs text-muted tabular-nums">
            <span :class="priceVsGuide > 0 ? 'text-success' : priceVsGuide < 0 ? 'text-error' : ''">
              {{ priceVsGuide >= 0 ? '+' : '' }}{{ priceVsGuide.toFixed(1) }}% vs guide price
            </span>
            · Offers match the best price first — bid above a sell offer and the difference comes straight back.
          </p>
        </div>

        <!-- Summary + CTA -->
        <div class="lg:col-span-2 flex flex-col rounded-xl bg-elevated/70 border border-default p-4 gap-2.5">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted">Quantity</span>
            <span class="tabular-nums font-medium"><GemBalance :value="safeQuantity" :compact="false" /></span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted">Price per gem</span>
            <span class="tabular-nums font-medium"><CoinBalance :value="safePrice" :compact="false" /></span>
          </div>
          <USeparator class="my-1" />
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted">{{ tradeMode === 'buy' ? 'Total (escrowed)' : 'You receive' }}</span>
            <div class="flex items-center gap-0.5 font-bold tabular-nums text-base" :class="tradeMode === 'buy' ? 'text-error' : 'text-success'">
              <span>{{ tradeMode === 'buy' ? '-' : '+' }}</span>
              <CoinBalance :value="orderTotal" :compact="false" />
            </div>
          </div>
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted">Match</span>
            <span v-if="fillPreview.instant === 0" class="text-muted flex items-center gap-1">
              <UIcon name="i-lucide-hourglass" class="size-3.5" /> waits on the book
            </span>
            <span v-else-if="fillPreview.rest === 0" class="text-success font-medium flex items-center gap-1">
              <UIcon name="i-lucide-zap" class="size-3.5" />
              {{ safeQuantity === 1 ? 'trades instantly' : `all ${formatNumber(fillPreview.instant, false)} trade instantly` }}
            </span>
            <span v-else class="font-medium flex items-center gap-1 tabular-nums">
              <span class="text-success flex items-center gap-1">
                <UIcon name="i-lucide-zap" class="size-3.5" />{{ formatNumber(fillPreview.instant, false) }} instantly
              </span>
              <span class="text-muted font-normal">· {{ formatNumber(fillPreview.rest, false) }} wait{{ fillPreview.rest === 1 ? 's' : '' }} on the book</span>
            </span>
          </div>
          <div v-if="fillPreview.bonus > 0" class="flex items-center justify-between text-xs">
            <span class="text-muted">{{ tradeMode === 'buy' ? 'Change back (est.)' : 'Higher bids available (est.)' }}</span>
            <div class="flex items-center gap-0.5 text-success font-medium tabular-nums">
              <span>+</span>
              <CoinBalance :value="fillPreview.bonus" :compact="false" />
            </div>
          </div>
          <div class="mt-auto pt-2">
            <UButton
                block
                size="xl"
                :color="tradeMode === 'buy' ? 'success' : 'error'"
                :label="`${tradeMode === 'buy' ? 'Buy' : 'Sell'} ${formatNumber(safeQuantity, false)} gem${safeQuantity !== 1 ? 's' : ''}`"
                :loading="loading"
                :disabled="!canSubmit"
                @click="placeOrder"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Chart + Order book -->
    <div class="grid lg:grid-cols-3 gap-6">
      <UCard ref="chartRef" class="lg:col-span-2" :ui="{ body: '!px-0 !pt-0 !pb-3' }">
        <template #header>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs text-muted uppercase tracking-wide mb-0.5">Trade Price History</p>
              <div class="text-xl font-semibold tabular-nums" :class="chartUp ? 'text-success' : 'text-error'">
                <CoinBalance :value="lastPrice ?? guidePrice" :compact="false" />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex rounded-md overflow-hidden border border-default text-xs font-semibold">
                <button
                    v-for="view in (['24h', '7d', '30d'] as const)"
                    :key="view"
                    class="px-2.5 py-1 transition-colors"
                    :class="chartView === view ? 'bg-primary text-white' : 'hover:bg-elevated text-muted'"
                    @click="chartView = view"
                >{{ view }}</button>
              </div>
              <UBadge
                  :label="`${data?.history.length ?? 0} trades`"
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
          <p class="text-sm">No trades yet — the first match sets the price</p>
        </div>
      </UCard>

      <!-- Order book -->
      <UCard :ui="{ body: '!p-0' }">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Order Book</h2>
            <UBadge
                v-if="spread !== null"
                :label="`spread ${formatNumber(spread, false)}`"
                color="neutral"
                variant="subtle"
            />
          </div>
        </template>

        <div
            v-if="!data?.book.bids.length && !data?.book.asks.length"
            class="py-12 flex flex-col items-center gap-2 text-muted"
        >
          <UIcon name="i-lucide-book-open" class="size-10 opacity-20" />
          <p class="text-sm">The book is empty — place the first offer!</p>
        </div>

        <div v-else class="grid grid-cols-2 divide-x divide-default">
          <!-- Bids -->
          <div>
            <div class="flex justify-between px-4 py-2 text-xs text-muted uppercase tracking-wide border-b border-default">
              <span>Qty</span>
              <span class="text-success">Buying at</span>
            </div>
            <button
                v-for="(level, index) in data.book.bids"
                :key="`bid-${level.price}`"
                type="button"
                class="relative flex w-full cursor-pointer justify-between px-4 py-1.5 text-sm tabular-nums transition-colors hover:bg-success/10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-success"
                :aria-label="bookLevelLabel('buy', index)"
                title="Prefill a sell through this bid"
                @click="selectBookLevel('buy', index)"
            >
              <div
                  class="pointer-events-none absolute inset-y-0 right-0 bg-success/10"
                  :style="{ width: `${Math.round(level.quantity / maxBidDepth * 100)}%` }"
              />
              <span class="relative text-muted flex items-center gap-1">
                <UIcon name="i-lucide-gem" class="size-3 text-cyan-400" />{{ formatNumber(level.quantity) }}
              </span>
              <span class="relative font-medium text-success flex items-center gap-1">
                <UIcon name="i-lucide-coins" class="size-3 text-yellow-400" />{{ formatNumber(level.price) }}
              </span>
            </button>
          </div>
          <!-- Asks -->
          <div>
            <div class="flex justify-between px-4 py-2 text-xs text-muted uppercase tracking-wide border-b border-default">
              <span class="text-error">Selling at</span>
              <span>Qty</span>
            </div>
            <button
                v-for="(level, index) in data.book.asks"
                :key="`ask-${level.price}`"
                type="button"
                class="relative flex w-full cursor-pointer justify-between px-4 py-1.5 text-sm tabular-nums transition-colors hover:bg-error/10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-error"
                :aria-label="bookLevelLabel('sell', index)"
                title="Prefill a buy through this ask"
                @click="selectBookLevel('sell', index)"
            >
              <div
                  class="pointer-events-none absolute inset-y-0 left-0 bg-error/10"
                  :style="{ width: `${Math.round(level.quantity / maxAskDepth * 100)}%` }"
              />
              <span class="relative font-medium text-error flex items-center gap-1">
                <UIcon name="i-lucide-coins" class="size-3 text-yellow-400" />{{ formatNumber(level.price) }}
              </span>
              <span class="relative text-muted flex items-center gap-1">
                <UIcon name="i-lucide-gem" class="size-3 text-cyan-400" />{{ formatNumber(level.quantity) }}
              </span>
            </button>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Live offers + recent trades -->
    <div class="grid lg:grid-cols-2 gap-6">
      <!-- All open orders -->
      <UCard :ui="{ body: '!p-0' }">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Live Offers</h2>
            <div class="flex items-center gap-2">
              <UTooltip text="Buying only" :delay-duration="120">
                <UButton
                    size="xs"
                    :color="sideFilter === 'buy' ? 'success' : 'neutral'"
                    :variant="sideFilter === 'buy' ? 'solid' : 'soft'"
                    icon="i-lucide-trending-up"
                    square
                    @click="toggleSideFilter('buy')"
                />
              </UTooltip>
              <UTooltip text="Selling only" :delay-duration="120">
                <UButton
                    size="xs"
                    :color="sideFilter === 'sell' ? 'error' : 'neutral'"
                    :variant="sideFilter === 'sell' ? 'solid' : 'soft'"
                    icon="i-lucide-trending-down"
                    square
                    @click="toggleSideFilter('sell')"
                />
              </UTooltip>
              <UButton
                  v-if="user"
                  size="xs"
                  :color="showMineOnly ? 'primary' : 'neutral'"
                  :variant="showMineOnly ? 'solid' : 'soft'"
                  icon="i-lucide-user"
                  label="Mine"
                  @click="showMineOnly = !showMineOnly"
              />
              <UBadge :label="`${visibleOrders.length} open`" color="neutral" variant="subtle" />
            </div>
          </div>
        </template>

        <div
            v-if="!visibleOrders.length"
            class="py-12 flex flex-col items-center gap-2 text-muted"
        >
          <UIcon name="i-lucide-inbox" class="size-10 opacity-20" />
          <p class="text-sm">{{ showMineOnly || sideFilter ? 'No offers match these filters' : 'No open offers right now' }}</p>
        </div>

        <UScrollArea v-else class="max-h-96">
          <TransitionGroup name="live-list" tag="div" class="relative divide-y divide-default">
            <div
                v-for="order in visibleOrders"
                :key="order.id"
                class="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/50 transition-colors"
            >
              <ProfileEmblem :emblem="order.userEmblem" :name="order.userName" class="size-8 shrink-0" />

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-sm font-semibold truncate">{{ order.userName ?? 'Unknown' }}</span>
                  <UBadge v-if="order.mine" label="You" color="primary" variant="subtle" size="sm" />
                  <span class="text-sm font-semibold" :class="order.side === 'buy' ? 'text-success' : 'text-error'">
                    {{ order.side === 'buy' ? 'buying' : 'selling' }}
                  </span>
                  <span class="text-sm tabular-nums font-medium">
                    {{ formatNumber(order.quantity - order.filled, false) }}
                    <UIcon name="i-lucide-gem" class="size-3 inline text-cyan-400" />
                  </span>
                  <UBadge
                      v-if="order.filled > 0"
                      :label="`${formatNumber(order.filled, false)}/${formatNumber(order.quantity, false)} filled`"
                      color="neutral"
                      variant="outline"
                      size="sm"
                  />
                </div>
                <p class="text-xs text-muted mt-0.5">
                  {{ timeAgo(order.createdAt) }}
                </p>
              </div>

              <div class="text-right shrink-0">
                <div class="flex justify-end text-sm font-bold tabular-nums">
                  <CoinBalance :value="gemOrderTotal(order.price, order.quantity - order.filled)" />
                </div>
                <p class="text-xs text-muted tabular-nums">@ {{ formatNumber(order.price, false) }} / gem</p>
              </div>
              <UButton
                  v-if="order.mine"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  class="shrink-0"
                  :loading="cancelling === order.id"
                  @click="cancelOrder(order.id)"
              />
            </div>
          </TransitionGroup>
        </UScrollArea>
      </UCard>

      <!-- Recent trades -->
      <UCard :ui="{ body: '!p-0' }">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Recent Trades</h2>
            <div class="flex items-center gap-2">
              <UButton
                  v-if="user"
                  size="xs"
                  :color="showMineTradesOnly ? 'primary' : 'neutral'"
                  :variant="showMineTradesOnly ? 'solid' : 'soft'"
                  icon="i-lucide-user"
                  label="Mine"
                  @click="showMineTradesOnly = !showMineTradesOnly"
              />
              <UBadge :label="`${visibleTrades.length} shown`" color="neutral" variant="subtle" />
            </div>
          </div>
        </template>

        <div
            v-if="!visibleTrades.length"
            class="py-12 flex flex-col items-center gap-2 text-muted"
        >
          <UIcon name="i-lucide-activity" class="size-10 opacity-20" />
          <p class="text-sm">{{ showMineTradesOnly ? 'You have no trades yet' : 'No trades yet — be part of the first!' }}</p>
        </div>

        <UScrollArea v-else class="max-h-96">
          <TransitionGroup name="live-list" tag="div" class="relative divide-y divide-default">
            <div
                v-for="trade in visibleTrades"
                :key="trade.id"
                class="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/50 transition-colors"
            >
              <div class="flex shrink-0 -space-x-2.5">
                <ProfileEmblem :emblem="trade.sellerEmblem" :name="trade.sellerName" class="size-8 ring-2 ring-(--ui-bg)" />
                <ProfileEmblem :emblem="trade.buyerEmblem" :name="trade.buyerName" class="size-8 ring-2 ring-(--ui-bg)" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm truncate">
                  <span class="font-semibold" :class="showMineTradesOnly && trade.iSold ? 'text-error' : ''">{{ trade.sellerName ?? 'Unknown' }}</span>
                  <UIcon name="i-lucide-arrow-right" class="size-3 inline mx-1 text-muted" />
                  <span class="font-semibold" :class="showMineTradesOnly && trade.iBought ? 'text-success' : ''">{{ trade.buyerName ?? 'Unknown' }}</span>
                  <UBadge
                      v-if="showMineTradesOnly"
                      :label="trade.iBought ? 'bought' : 'sold'"
                      :color="trade.iBought ? 'success' : 'error'"
                      variant="subtle"
                      size="sm"
                      class="ml-1.5"
                  />
                </p>
                <p class="text-xs text-muted mt-0.5">
                  {{ timeAgo(trade.createdAt) }}
                </p>
              </div>
              <div class="text-right shrink-0">
                <div class="flex justify-end text-sm font-bold tabular-nums">
                  <GemBalance :value="trade.quantity" />
                </div>
                <p class="text-xs text-muted tabular-nums flex items-center justify-end gap-1">
                  <UIcon name="i-lucide-coins" class="size-3 text-yellow-400" />{{ formatNumber(trade.price, false) }}
                </p>
              </div>
            </div>
          </TransitionGroup>
        </UScrollArea>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
/* Live list enter/leave/reorder animations (offers + trades) */
.live-list-enter-active,
.live-list-leave-active,
.live-list-move {
  transition: all 0.3s ease;
}
.live-list-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
/* Leaving rows collapse in place instead of going position:absolute — an
   absolute row keeps painting past the shrunken list height and flashes the
   scroll area's scrollbar for the duration of the animation. */
.live-list-leave-active {
  overflow: hidden;
  max-height: 80px;
}
.live-list-leave-to {
  opacity: 0;
  transform: translateX(16px);
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

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
