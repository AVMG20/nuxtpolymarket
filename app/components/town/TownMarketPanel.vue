<script setup lang="ts">
import TownCoin from '~/components/town/TownCoin.vue'
import TownAsset from '~/components/town/TownAsset.vue'
import TownProductionChart from '~/components/town/TownProductionChart.vue'
import type { TownResourceView, TownOrderView } from '~/composables/useTown'
import { TOWN_MARKET_MIN_PRICE, TOWN_MAX_ORDER_PRICE } from '#shared/utils/gamelogic/town'

interface BookPlayer { id: string, name: string, image: string | null, quantity: number, mine: boolean }
interface BookLevel { price: number, quantity: number, players: BookPlayer[] }
interface MarketData {
    resource: string
    floor: number
    ceiling: number
    guidePrice: number
    bids: BookLevel[]
    asks: BookLevel[]
    trades: { price: number, quantity: number, at: number, mine: boolean }[]
    myOrders: { id: string, side: 'buy' | 'sell', price: number, quantity: number, filled: number, createdAt: number }[]
}

interface ProductionData {
    bucketMs: number
    buckets: { at: number, totals: Record<string, number> }[]
}

const props = defineProps<{
    resources: TownResourceView[]
    inventory: Record<string, number>
    lastPrices: Record<string, number>
    myOrders: TownOrderView[]
    balance: number
    initialResource: string | null
    busy: boolean
    /** Net units per tick, per resource. Negative means the town consumes it. */
    netPerTick: Record<string, number>
    speedMultiplier: number
    tickMs: number
    /** Per-resource storage cap. Full storage halts the workshops that fill it. */
    storageCap: number
    /** Jewels one gem costs at the market. */
    jewelsPerGem: number
}>()

const emit = defineEmits<{
    close: []
    'sell-floor': [resource: string, quantity: number]
    'sell-bulk': [items: { resource: string, quantity: number }[]]
    'place-order': [resource: string, side: 'buy' | 'sell', price: number, quantity: number]
    'cancel-order': [orderId: string]
    convert: [gems: number]
}>()

/** Sentinel for the overview entry at the top of the list. No resource uses this id. */
const ALL = 'all'
/** Sentinel for the gems tab: where jewels are turned into gems. */
const GEMS = 'gems'

/** Where a resource id opens from the HUD: the gems tab for jewels, its own book for anything else. */
function tabFor(resource: string | null): string {
    if (!resource) return ALL
    return resource === 'jewels' ? GEMS : resource
}

/** One colour per resource, shared by the chart, the legend and the list dots. */
const RESOURCE_COLORS: Record<string, string> = {
    wheat: '#f5c451',
    wood: '#a5713f',
    stone: '#98a2ad',
    flour: '#efe3c3',
    planks: '#d9a86c',
    bricks: '#c1502e',
    bread: '#f59331',
    tools: '#5b8fc9',
    ore: '#69788c',
    steel: '#cdd5de',
    machines: '#a476e8',
    luxuries: '#e662b8',
    jewels: '#b18cff'
}

function colorFor(id: string) {
    return RESOURCE_COLORS[id] ?? 'var(--g-muted)'
}

const selected = ref<string>(tabFor(props.initialResource))
watch(() => props.initialResource, (r) => { if (r) selected.value = tabFor(r) })

const isAll = computed(() => selected.value === ALL)
const isGems = computed(() => selected.value === GEMS)
const resource = computed(() => props.resources.find(r => r.id === selected.value) ?? null)
const owned = computed(() => props.inventory[selected.value] ?? 0)
const resourceNames = computed<Record<string, string>>(() => Object.fromEntries(props.resources.map(r => [r.id, r.name])))

const market = ref<MarketData | null>(null)
const loading = ref(false)
let fetchSeq = 0

async function loadMarket() {
    const id = selected.value
    if (id === ALL || id === GEMS) { fetchSeq++; loading.value = false; return }
    const seq = ++fetchSeq
    loading.value = true
    try {
        const data = await $fetch<MarketData>(`/api/town/market/${id}`)
        if (seq === fetchSeq) market.value = data
    } catch {
        // keep the previous book on a transient failure
    } finally {
        if (seq === fetchSeq) loading.value = false
    }
}

watch(selected, () => { market.value = null; loadMarket() }, { immediate: true })
watch(() => props.myOrders, () => loadMarket())

// Live invalidation: the server pings which resource book changed. Losing the
// socket costs nothing but freshness — the panel still refetches on its own —
// so a refusal is accepted rather than retried.
let ws: WebSocket | null = null
let unmounted = false
let retries = 0
/** Close codes that mean "do not come back": unauthorised, and channel full. */
const FINAL_CLOSE = new Set([4401, 4429])
const MAX_RETRIES = 5

function connect() {
    if (unmounted || ws || !import.meta.client) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/town/ws`)
    ws.onopen = () => { retries = 0 }
    ws.onmessage = (ev) => {
        try {
            const msg = JSON.parse(String(ev.data)) as { type?: string, resource?: string }
            if (msg.type === 'market' && msg.resource === selected.value) loadMarket()
        } catch { /* ignore */ }
    }
    ws.onclose = (ev) => {
        ws = null
        if (unmounted || FINAL_CLOSE.has(ev.code) || retries >= MAX_RETRIES) return
        // Back off, so a server that is refusing everybody is not hammered by
        // every open tab every two seconds.
        retries++
        setTimeout(connect, Math.min(30_000, 2000 * 2 ** (retries - 1)))
    }
}
onMounted(connect)
onBeforeUnmount(() => {
    unmounted = true
    ws?.close()
})

// ── Overview: production history ──
const RANGES = [
    { hours: 24, label: '24h' },
    { hours: 72, label: '3d' },
    { hours: 168, label: '7d' }
] as const

const rangeHours = ref<number>(24)
const production = ref<ProductionData | null>(null)
const prodLoading = ref(false)
let prodSeq = 0

async function loadProduction() {
    if (!import.meta.client) return
    const hours = rangeHours.value
    const seq = ++prodSeq
    prodLoading.value = true
    try {
        const data = await $fetch<ProductionData>('/api/town/production', { query: { hours } })
        if (seq === prodSeq) production.value = data
    } catch {
        if (seq === prodSeq) production.value = null
    } finally {
        if (seq === prodSeq) prodLoading.value = false
    }
}

watch([isAll, rangeHours], ([all], prev) => {
    if (!all) return
    // Re-fetch when the range changed, or when the overview was just opened.
    if (prev && prev[0] === true && prev[1] === rangeHours.value) return
    production.value = null
    loadProduction()
}, { immediate: true })

/** Resources with any production at all in the fetched window, in list order. */
const producedSeries = computed(() => {
    const totals: Record<string, number> = {}
    for (const b of production.value?.buckets ?? []) {
        for (const [id, v] of Object.entries(b.totals)) totals[id] = (totals[id] ?? 0) + v
    }
    return props.resources.map(r => r.id).filter(id => (totals[id] ?? 0) > 0)
})

const hiddenSeries = ref<Set<string>>(new Set())
function toggleSeries(id: string) {
    const next = new Set(hiddenSeries.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    hiddenSeries.value = next
}

const visibleSeries = computed(() => producedSeries.value.filter(id => !hiddenSeries.value.has(id)))

// ── Overview: bulk sell ──
const ticksPerHour = computed(() => (3_600_000 / (props.tickMs || 60_000)) * (props.speedMultiplier || 1))

/**
 * Jewels are worth far more converted than sold, so the bulk buttons leave
 * them alone unless the mayor ticks the box. Off every time the window opens.
 */
const includeHeld = ref(false)
const heldBack = computed(() => props.resources.filter(r => r.soldByDefault === false))
const heldBackOwned = computed(() => heldBack.value.reduce((n, r) => n + (props.inventory[r.id] ?? 0), 0))

const ownedRows = computed(() => props.resources
    .filter(r => includeHeld.value || r.soldByDefault !== false)
    .map(r => ({
        id: r.id,
        name: r.name,
        owned: props.inventory[r.id] ?? 0,
        floor: r.floorPrice,
        perHour: Math.round((props.netPerTick[r.id] ?? 0) * ticksPerHour.value)
    }))
    .filter(r => r.owned > 0))

const keep = ref(0)
onMounted(() => {
    const raw = Number(localStorage.getItem('polytown-keep'))
    if (Number.isFinite(raw) && raw > 0) keep.value = Math.floor(raw)
})
watch(keep, (v) => {
    if (!import.meta.client) return
    localStorage.setItem('polytown-keep', String(Math.max(0, Math.floor(v || 0))))
})

type SellItem = { resource: string, quantity: number }

function itemsForFraction(fraction: number): SellItem[] {
    return ownedRows.value
        .map(r => ({ resource: r.id, quantity: Math.max(0, Math.floor(r.owned * fraction)) }))
        .filter(i => i.quantity >= 1)
}

function itemsAboveKeep(): SellItem[] {
    const k = Math.max(0, Math.floor(keep.value || 0))
    return ownedRows.value
        .map(r => ({ resource: r.id, quantity: Math.max(0, r.owned - k) }))
        .filter(i => i.quantity >= 1)
}

const floorById = computed(() => new Map(props.resources.map(r => [r.id, r.floorPrice])))

// ── Gems ──
const jewels = computed(() => props.inventory.jewels ?? 0)
const jewelsPerDay = computed(() => (props.netPerTick.jewels ?? 0) * ticksPerHour.value * 24)
/** Whole gems the jewels on hand convert into. */
const gemsReady = computed(() => Math.floor(jewels.value / Math.max(1, props.jewelsPerGem)))
const convertQty = ref(0)
watch(gemsReady, (n) => { convertQty.value = n }, { immediate: true })
const convertValid = computed(() => Number.isInteger(convertQty.value) && convertQty.value >= 1 && convertQty.value <= gemsReady.value)
const jewelRatio = computed(() => props.storageCap > 0 ? Math.min(1, jewels.value / props.storageCap) : 0)
const jewelClass = computed(() => jewelRatio.value >= 0.9 ? 'bad' : jewelRatio.value >= 0.7 ? 'meh' : 'ok')
/** Days until storage is full of jewels at the current rate, or null when it is not filling. */
const jewelFullDays = computed(() => {
    if (jewelsPerDay.value <= 0 || props.storageCap <= jewels.value) return null
    return (props.storageCap - jewels.value) / jewelsPerDay.value
})
function fmtDays(days: number) {
    if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`
    return `${Math.round(days * 10) / 10}d`
}
function convert() {
    if (!convertValid.value) return
    emit('convert', Math.floor(convertQty.value))
}

function valueOf(items: SellItem[]) {
    let total = 0
    for (const i of items) total += (floorById.value.get(i.resource) ?? 0) * i.quantity
    return total
}

/** Precomputed once per inventory change so the buttons can show what they'd pay out. */
const quickSells = computed(() => [0.25, 0.5, 0.75, 1].map((fraction) => {
    const items = itemsForFraction(fraction)
    return { fraction, label: fraction === 1 ? 'All' : `${fraction * 100}%`, items, value: valueOf(items) }
}))

const keepSell = computed(() => {
    const items = itemsAboveKeep()
    return { items, value: valueOf(items) }
})

function sellItems(items: SellItem[]) {
    const clean = items.filter(i => i.quantity >= 1)
    if (!clean.length) return
    emit('sell-bulk', clean)
}

function fmtRate(perHour: number) {
    if (!perHour) return '0/h'
    return perHour > 0 ? `+${formatNumber(perHour)}/h` : `−${formatNumber(Math.abs(perHour))}/h`
}

// ── Quick trade ──
const quickQty = ref(1)
watch(selected, () => { quickQty.value = Math.min(Math.max(1, owned.value), 100) })

/** Resting bids with your own taken out — a quick sell never fills your own offer. */
const otherBids = computed(() => {
    const mine = new Map<number, number>()
    for (const o of market.value?.myOrders ?? []) {
        if (o.side === 'buy') mine.set(o.price, (mine.get(o.price) ?? 0) + (o.quantity - o.filled))
    }
    return (market.value?.bids ?? [])
        .map(l => ({ price: l.price, quantity: l.quantity - (mine.get(l.price) ?? 0) }))
        .filter(l => l.quantity > 0)
})

/**
 * What a quick sell pays: every bid above the town hall's floor, best first,
 * then the hall for the rest. Mirrors what the server actually does.
 */
const sellQuote = computed(() => {
    const want = Math.max(0, Math.floor(quickQty.value || 0))
    const floor = resource.value?.floorPrice ?? 0
    let left = want
    let total = 0
    let toPlayers = 0
    let best = 0
    for (const lvl of otherBids.value) {
        if (left <= 0) break
        if (lvl.price <= floor) break
        const take = Math.min(left, lvl.quantity)
        total += take * lvl.price
        toPlayers += take
        best = Math.max(best, lvl.price)
        left -= take
    }
    total += left * floor
    return { total, toPlayers, best, floor }
})

// ── Storage ──
// A resource sitting at its cap is not a full cupboard, it is a stopped
// production line, so the bar turns red before it gets there.
const storeRatio = computed(() => props.storageCap > 0 ? Math.min(1, owned.value / props.storageCap) : 0)
const storeFull = computed(() => storeRatio.value >= 0.999)
const storeClass = computed(() => storeRatio.value >= 0.9 ? 'bad' : storeRatio.value >= 0.7 ? 'meh' : 'ok')
/** Cheapest way to buy `quickQty` right now by eating the ask book, or null if the book is too thin. */
const buyQuote = computed(() => {
    const want = Math.max(0, Math.floor(quickQty.value || 0))
    if (!market.value || want < 1) return null
    let left = want
    let cost = 0
    for (const lvl of market.value.asks) {
        const take = Math.min(left, lvl.quantity)
        cost += take * lvl.price
        left -= take
        if (left <= 0) break
    }
    return left > 0 ? null : { cost, worstPrice: market.value.asks[market.value.asks.length - 1]?.price ?? 0 }
})

// ── Player order ──
const orderSide = ref<'buy' | 'sell'>('sell')
const orderPrice = ref<number>(0)
const orderQty = ref<number>(1)
watch([market, orderSide], ([m]) => {
    if (!m) return
    if (orderSide.value === 'sell') {
        orderPrice.value = m.bids[0]?.price ?? Math.round(m.guidePrice * 100) / 100
    } else {
        orderPrice.value = m.asks[0]?.price ?? Math.round(m.guidePrice * 100) / 100
    }
}, { immediate: true })

const orderTotal = computed(() => Math.round((orderPrice.value || 0) * 100) * Math.max(0, Math.floor(orderQty.value || 0)) / 100)
/** Why the offer button is off, or null when it is on. Shown next to the button. */
const orderIssue = computed(() => {
    if (!market.value) return 'Loading the book…'
    const p = orderPrice.value
    const q = Math.floor(orderQty.value || 0)
    // Price is unbounded in both directions bar the sanity limits the server
    // keeps; a UI that refuses what the API accepts is just a worse client.
    if (!Number.isFinite(p) || p < TOWN_MARKET_MIN_PRICE) return `Price must be at least ${TOWN_MARKET_MIN_PRICE}`
    if (p > TOWN_MAX_ORDER_PRICE) return 'Price is too high'
    if (q < 1) return 'Enter an amount'
    if (orderSide.value === 'sell' && q > owned.value) return `You only have ${formatNumber(owned.value)}`
    if (orderSide.value === 'buy' && orderTotal.value > props.balance) return 'Not enough coins'
    return null
})
const orderValid = computed(() => orderIssue.value === null)

function fillFromLevel(side: 'buy' | 'sell', level: BookLevel) {
    // Clicking an ask = you buy at that price; clicking a bid = you sell into it.
    orderSide.value = side === 'sell' ? 'buy' : 'sell'
    orderPrice.value = level.price
    orderQty.value = Math.max(1, Math.min(level.quantity, orderSide.value === 'sell' ? owned.value || 1 : level.quantity))
}

function fmtPrice(p: number) {
    return p >= 1000 ? formatNumber(p) : p.toFixed(2).replace(/\.00$/, '')
}

/** Deepest level on either side, so the depth bars share one scale. */
const bookMax = computed(() => Math.max(1, ...(market.value?.bids ?? []).map(l => l.quantity), ...(market.value?.asks ?? []).map(l => l.quantity)))

function depthWidth(level: BookLevel) {
    return `${Math.max(6, Math.round((level.quantity / bookMax.value) * 100))}%`
}

/** Faces to show on a level: the first three, plus a "+N" chip for the rest. */
function facesFor(level: BookLevel) {
    return level.players.slice(0, 3)
}

function timeAgo(at: number) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000))
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86_400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86_400)}d`
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div class="g-window-head">
            <h2>🏪 Market</h2>
            <button class="g-icon g-icon-sm" @click="emit('close')">✕</button>
        </div>

        <div class="flex min-h-0 flex-1">
            <!-- Resource list -->
            <div class="mk-list">
                <button class="mk-item" :class="isAll ? 'is-active' : ''" @click="selected = ALL">
                    <span class="text-lg leading-none">📊</span>
                    <span class="min-w-0 flex-1 text-left">
                        <span class="block truncate text-sm font-bold leading-tight">All</span>
                        <span class="block text-[11px] leading-tight opacity-60">Production &amp; bulk sell</span>
                    </span>
                </button>
                <button class="mk-item" :class="isGems ? 'is-active' : ''" @click="selected = GEMS">
                    <span class="text-lg leading-none">💎</span>
                    <span class="min-w-0 flex-1 text-left">
                        <span class="block truncate text-sm font-bold leading-tight">Gems</span>
                        <span class="block text-[11px] leading-tight opacity-60 tabular-nums">{{ formatNumber(jewels) }} jewels</span>
                    </span>
                    <span v-if="gemsReady > 0" class="mk-ready">{{ gemsReady }}</span>
                </button>
                <div class="mk-sep" />
                <button v-for="r in resources" :key="r.id" class="mk-item" :class="selected === r.id ? 'is-active' : ''" @click="selected = r.id">
                    <span class="mk-dot" :style="{ background: colorFor(r.id) }" />
                    <span class="text-lg leading-none"><TownAsset :id="r.id" /></span>
                    <span class="min-w-0 flex-1 text-left">
                        <span class="block truncate text-sm font-bold leading-tight">{{ r.name }}</span>
                        <span class="block text-[11px] leading-tight opacity-60 tabular-nums">{{ formatNumber(inventory[r.id] ?? 0) }} owned</span>
                    </span>
                    <span class="text-[11px] opacity-50 tabular-nums">{{ fmtPrice(lastPrices[r.id] ?? r.floorPrice) }}</span>
                </button>
            </div>

            <!-- Overview -->
            <div v-if="isAll" class="mk-detail">
                <section class="mk-sec">
                    <header class="flex items-center justify-between">
                        <span>Production <span class="opacity-50">— units made per hour</span></span>
                        <span class="mk-toggle">
                            <button v-for="r in RANGES" :key="r.hours" :class="rangeHours === r.hours ? 'is-on' : ''" @click="rangeHours = r.hours">{{ r.label }}</button>
                        </span>
                    </header>

                    <div v-if="prodLoading && !production" class="py-10 text-center text-xs opacity-50">Loading production…</div>
                    <div v-else-if="!producedSeries.length" class="py-10 text-center text-xs opacity-60">Nothing produced yet — build a farm</div>
                    <template v-else>
                        <TownProductionChart
                            :buckets="production?.buckets ?? []"
                            :series="visibleSeries"
                            :colors="RESOURCE_COLORS"
                            :names="resourceNames"
                            :hours="rangeHours"
                        />
                        <div class="mt-2 flex flex-wrap gap-1.5">
                            <button
                                v-for="id in producedSeries"
                                :key="id"
                                class="mk-legend"
                                :class="hiddenSeries.has(id) ? 'is-off' : ''"
                                @click="toggleSeries(id)"
                            >
                                <span class="mk-dot" :style="{ background: colorFor(id) }" />
                                {{ resourceNames[id] ?? id }}
                            </button>
                        </div>
                    </template>
                </section>

                <section class="mk-sec">
                    <header>Sell in bulk <span class="opacity-50">— best offers first, the town hall for the rest, all in one go</span></header>

                    <div v-if="!ownedRows.length" class="py-4 text-center text-xs opacity-60">Your warehouse is empty</div>
                    <template v-else>
                        <p class="mb-2 text-[11px] opacity-55">Totals are what the town hall guarantees — any mayor bidding more is taken first, so you get at least this.</p>
                        <label v-if="heldBack.length" class="mk-check" :data-tip="`${heldBack.map(r => r.name).join(', ')} are worth far more as gems. Tick this only if you really want the town hall to take them.`">
                            <input v-model="includeHeld" type="checkbox">
                            <span>Include <template v-for="(r, i) in heldBack" :key="r.id"><template v-if="i">, </template><TownAsset :id="r.id" /> {{ r.name }}</template> in these sales</span>
                            <span class="opacity-50 tabular-nums">{{ formatNumber(heldBackOwned) }} held</span>
                        </label>
                        <div class="mk-actions">
                            <button
                                v-for="q in quickSells"
                                :key="q.fraction"
                                class="g-btn py-2 text-xs"
                                :disabled="busy || q.value <= 0"
                                @click="sellItems(q.items)"
                            >
                                Sell {{ q.label }}
                                <b class="ml-1" style="color: var(--g-gold)">≥ <TownCoin /> {{ formatNumber(q.value) }}</b>
                            </button>
                        </div>

                        <div class="mk-actions mt-2">
                            <label class="text-xs opacity-60">Keep</label>
                            <input v-model.number="keep" type="number" min="0" class="g-input w-24">
                            <button class="g-btn g-btn-primary py-2 text-xs" :disabled="busy || keepSell.value <= 0" @click="sellItems(keepSell.items)">
                                Sell above keep
                                <b class="ml-1">≥ <TownCoin /> {{ formatNumber(keepSell.value) }}</b>
                            </button>
                            <span class="text-[11px] opacity-50">Leaves {{ formatNumber(Math.max(0, Math.floor(keep || 0))) }} of each good in store.</span>
                        </div>

                        <div class="mk-table mt-3">
                            <div class="mk-row mk-row-head">
                                <span>Good</span>
                                <span>Owned</span>
                                <span>Rate</span>
                                <span>Hall pays</span>
                                <span>Worth</span>
                                <span />
                            </div>
                            <div v-for="r in ownedRows" :key="r.id" class="mk-row">
                                <span class="flex min-w-0 items-center gap-2">
                                    <span class="mk-dot" :style="{ background: colorFor(r.id) }" />
                                    <TownAsset :id="r.id" />
                                    <span class="truncate">{{ r.name }}</span>
                                </span>
                                <span class="tabular-nums">{{ formatNumber(r.owned) }}</span>
                                <span class="tabular-nums" :style="{ color: r.perHour > 0 ? 'var(--g-green)' : r.perHour < 0 ? 'var(--g-red)' : undefined }">{{ fmtRate(r.perHour) }}</span>
                                <span class="tabular-nums opacity-60">{{ fmtPrice(r.floor) }}</span>
                                <span class="tabular-nums"><TownCoin /> {{ formatNumber(r.owned * r.floor) }}</span>
                                <span class="text-right">
                                    <button class="g-btn px-2 py-1 text-[11px]" :disabled="busy" @click="sellItems([{ resource: r.id, quantity: r.owned }])">Sell all</button>
                                </span>
                            </div>
                        </div>
                    </template>
                </section>
            </div>

            <!-- Gems -->
            <div v-else-if="isGems" class="mk-detail">
                <div class="mk-title">
                    <span class="text-4xl drop-shadow"><TownAsset id="jewels" /></span>
                    <div class="flex-1">
                        <div class="text-lg font-black leading-tight">Gems</div>
                        <div class="text-xs opacity-60">{{ jewelsPerGem }} jewels make one gem · you hold <b class="opacity-100">{{ formatNumber(jewels) }}</b></div>
                    </div>
                    <div class="mk-prices">
                        <span><i>Digging</i><b style="color: var(--g-green)">{{ jewelsPerDay > 0 ? `+${Math.round(jewelsPerDay * 10) / 10}/day` : '—' }}</b></span>
                        <span><i>Ready</i><b style="color: var(--g-gem)">💎 {{ gemsReady }}</b></span>
                    </div>
                </div>

                <div class="mk-store" data-tip="Jewels share the warehouse cap with every other good. Full, the mines stop digging until you convert or sell — build warehouses to hold more between visits.">
                    <span class="mk-store-label">📦 Storage</span>
                    <span class="mk-store-bar"><i :class="jewelClass" :style="{ width: `${Math.round(jewelRatio * 100)}%` }" /></span>
                    <b class="mk-store-num">{{ formatNumber(jewels) }}<span class="opacity-45">/{{ formatNumber(storageCap) }}</span><span v-if="jewelFullDays !== null" class="ml-2 font-semibold opacity-50">full in {{ fmtDays(jewelFullDays) }}</span></b>
                </div>

                <section class="mk-sec">
                    <header>Convert jewels into gems <span class="opacity-50">— whole gems only, straight to your balance</span></header>
                    <div v-if="jewelsPerDay <= 0 && jewels <= 0" class="py-4 text-center text-xs opacity-60">No jewel mine yet. It is a tier-2 build — find it in the build menu.</div>
                    <template v-else>
                        <div class="flex flex-wrap items-center gap-2">
                            <input v-model.number="convertQty" type="number" min="1" :max="gemsReady" class="g-input w-24">
                            <button class="g-btn py-2 text-xs" :disabled="gemsReady < 1" @click="convertQty = gemsReady">All</button>
                            <span class="text-xs opacity-60 tabular-nums">= {{ formatNumber(Math.max(0, Math.floor(convertQty || 0)) * jewelsPerGem) }} <TownAsset id="jewels" /></span>
                            <div class="flex-1" />
                            <button class="g-btn g-btn-gem py-2" :disabled="busy || !convertValid" @click="convert">💎 Convert {{ convertValid ? Math.floor(convertQty) : '' }}</button>
                        </div>
                        <p class="mt-1 text-[11px] opacity-55">
                            <template v-if="gemsReady < 1">{{ formatNumber(jewelsPerGem - (jewels % jewelsPerGem)) }} more jewels until the next gem.</template>
                            <template v-else>Jewels also trade on the market like any other good — <button class="underline" @click="selected = 'jewels'">see the jewel book</button> — but a gem is worth far more than the town hall pays.</template>
                        </p>
                    </template>
                </section>
            </div>

            <!-- Detail -->
            <div v-else-if="resource" class="mk-detail">
                <div class="mk-title">
                    <span class="text-4xl drop-shadow"><TownAsset :id="resource.id" /></span>
                    <div class="flex-1">
                        <div class="text-lg font-black leading-tight">{{ resource.name }}</div>
                        <div class="text-xs opacity-60">Tier {{ resource.tier }} · you own <b class="opacity-100">{{ formatNumber(owned) }}</b></div>
                    </div>
                    <div class="mk-prices">
                        <span v-if="lastPrices[resource.id]"><i>Last traded</i><b style="color: var(--g-gold)">{{ fmtPrice(lastPrices[resource.id]!) }}</b></span>
                    </div>
                </div>

                <!-- Storage: full storage halts every workshop that makes this. -->
                <div class="mk-store" :data-tip="storeFull ? 'Over the cap — the workshops that make this have stopped until you are back under it. Buying past the cap is allowed; selling or a warehouse gets production going again.' : 'Build warehouses to hold more. Buying can take you over the cap — production just stops until you are back under.'">
                    <span class="mk-store-label">📦 Storage</span>
                    <span class="mk-store-bar"><i :class="storeClass" :style="{ width: `${Math.round(storeRatio * 100)}%` }" /></span>
                    <b class="mk-store-num">{{ formatNumber(owned) }}<span class="opacity-45">/{{ formatNumber(storageCap) }}</span></b>
                </div>

                <!-- Instant trade -->
                <section class="mk-sec">
                    <header>Trade now <span class="opacity-50">— selling takes the best offers first, then the town hall</span></header>
                    <div class="flex flex-wrap items-center gap-2">
                        <input v-model.number="quickQty" type="number" min="1" class="g-input w-24">
                        <button class="g-btn py-2 text-xs" @click="quickQty = owned">All</button>
                        <div class="flex-1" />
                        <button class="g-btn g-btn-primary py-2" :disabled="busy || owned < 1 || quickQty < 1 || quickQty > owned" @click="emit('sell-floor', resource.id, Math.floor(quickQty))">
                            Sell · <TownCoin /> {{ formatNumber(sellQuote.total) }}
                        </button>
                        <button
                            class="g-btn py-2"
                            :disabled="busy || !buyQuote || buyQuote.cost > balance"
                            :title="buyQuote ? 'Fills against the cheapest offers on sale' : 'Nothing on sale — place a buy offer below'"
                            @click="buyQuote && emit('place-order', resource.id, 'buy', buyQuote.worstPrice, Math.floor(quickQty))"
                        >
                            <span v-if="buyQuote">Buy · <TownCoin /> {{ formatNumber(buyQuote.cost) }}</span>
                            <span v-else>Nothing on sale</span>
                        </button>
                    </div>
                    <p class="mt-1 text-[11px] opacity-55">
                        <template v-if="quickQty > owned">You only have {{ formatNumber(owned) }} — sell that or less.</template>
                        <template v-else-if="sellQuote.toPlayers > 0">
                            {{ formatNumber(sellQuote.toPlayers) }} goes to mayors paying up to <b>{{ fmtPrice(sellQuote.best) }}</b>, the rest to the town hall at {{ fmtPrice(sellQuote.floor) }}.
                        </template>
                        <template v-else>Nobody is bidding above the town hall's {{ fmtPrice(sellQuote.floor) }}, so this all goes to the hall.</template>
                    </p>
                </section>

                <!-- Order book -->
                <section class="mk-sec">
                    <header>Player offers <span class="opacity-50">— each row is one price; click it to trade against it</span></header>
                    <div class="mk-book">
                        <div class="mk-book-side">
                            <div class="mk-book-head is-bid">
                                <span class="mk-book-who">Buyers</span>
                                <span>Pays each</span>
                                <span>Wants</span>
                                <span class="text-right">Total</span>
                            </div>
                            <template v-if="market && market.bids.length">
                                <button
                                    v-for="lvl in market.bids"
                                    :key="lvl.price"
                                    class="mk-book-row is-bid"
                                    :class="{ 'is-mine': lvl.players.some(p => p.mine) }"
                                    @click="fillFromLevel('buy', lvl)"
                                >
                                    <i class="mk-depth" :style="{ width: depthWidth(lvl) }" />
                                    <span class="mk-book-who">
                                        <UTooltip v-for="p in facesFor(lvl)" :key="p.id" :text="`${p.mine ? 'You' : p.name} · ${formatNumber(p.quantity)}`">
                                            <UAvatar :src="p.image ?? undefined" :alt="p.name" size="2xs" class="mk-face" :class="{ 'is-me': p.mine }" />
                                        </UTooltip>
                                        <UTooltip v-if="lvl.players.length > 3" :text="lvl.players.slice(3).map(p => p.name).join(', ')">
                                            <span class="mk-face mk-face-more">+{{ lvl.players.length - 3 }}</span>
                                        </UTooltip>
                                    </span>
                                    <span class="mk-book-price"><CoinBalance :value="lvl.price" :compact="lvl.price >= 1000" /></span>
                                    <span class="mk-book-qty">{{ formatNumber(lvl.quantity) }} <TownAsset :id="resource.id" /></span>
                                    <span class="mk-book-total"><CoinBalance :value="lvl.price * lvl.quantity" /></span>
                                </button>
                            </template>
                            <div v-else class="mk-book-empty">{{ loading && !market ? '…' : 'Nobody is buying' }}</div>
                        </div>

                        <div class="mk-book-side">
                            <div class="mk-book-head is-ask">
                                <span class="mk-book-who">Sellers</span>
                                <span>Asks each</span>
                                <span>Sells</span>
                                <span class="text-right">Total</span>
                            </div>
                            <template v-if="market && market.asks.length">
                                <button
                                    v-for="lvl in market.asks"
                                    :key="lvl.price"
                                    class="mk-book-row is-ask"
                                    :class="{ 'is-mine': lvl.players.some(p => p.mine) }"
                                    @click="fillFromLevel('sell', lvl)"
                                >
                                    <i class="mk-depth" :style="{ width: depthWidth(lvl) }" />
                                    <span class="mk-book-who">
                                        <UTooltip v-for="p in facesFor(lvl)" :key="p.id" :text="`${p.mine ? 'You' : p.name} · ${formatNumber(p.quantity)}`">
                                            <UAvatar :src="p.image ?? undefined" :alt="p.name" size="2xs" class="mk-face" :class="{ 'is-me': p.mine }" />
                                        </UTooltip>
                                        <UTooltip v-if="lvl.players.length > 3" :text="lvl.players.slice(3).map(p => p.name).join(', ')">
                                            <span class="mk-face mk-face-more">+{{ lvl.players.length - 3 }}</span>
                                        </UTooltip>
                                    </span>
                                    <span class="mk-book-price"><CoinBalance :value="lvl.price" :compact="lvl.price >= 1000" /></span>
                                    <span class="mk-book-qty">{{ formatNumber(lvl.quantity) }} <TownAsset :id="resource.id" /></span>
                                    <span class="mk-book-total"><CoinBalance :value="lvl.price * lvl.quantity" /></span>
                                </button>
                            </template>
                            <div v-else class="mk-book-empty">{{ loading && !market ? '…' : 'Nobody is selling' }}</div>
                        </div>
                    </div>
                    <p class="mt-2 text-[11px] opacity-50">Buyers pay the price shown for every unit. Sellers hand over units at theirs. A ring marks your own offers.</p>
                </section>

                <!-- Place order -->
                <section class="mk-sec">
                    <header class="flex items-center justify-between">
                        <span>Your offer</span>
                        <span class="mk-toggle">
                            <button :class="orderSide === 'sell' ? 'is-sell' : ''" @click="orderSide = 'sell'">Sell</button>
                            <button :class="orderSide === 'buy' ? 'is-buy' : ''" @click="orderSide = 'buy'">Buy</button>
                        </span>
                    </header>
                    <div class="flex flex-wrap items-center gap-2">
                        <label class="text-xs opacity-60">Price each</label>
                        <input v-model.number="orderPrice" type="number" step="0.01" :min="TOWN_MARKET_MIN_PRICE" class="g-input w-28">
                        <label class="text-xs opacity-60">×</label>
                        <input v-model.number="orderQty" type="number" min="1" class="g-input w-24">
                        <button v-if="orderSide === 'sell'" class="g-btn py-2 text-xs" @click="orderQty = owned">All</button>
                        <div class="flex flex-1 items-center justify-end gap-1 text-sm font-bold tabular-nums">= <CoinBalance :value="orderTotal" /></div>
                        <button class="g-btn py-2" :class="orderSide === 'sell' ? 'g-btn-danger' : 'g-btn-primary'" :disabled="busy || !orderValid" @click="emit('place-order', resource.id, orderSide, orderPrice, Math.floor(orderQty))">
                            {{ orderSide === 'sell' ? 'List for sale' : 'Place buy offer' }}
                        </button>
                    </div>
                    <p class="mt-1 text-[11px]" :class="orderIssue ? 'text-[color:var(--g-red)] opacity-90' : 'opacity-50'">
                        <template v-if="orderIssue">{{ orderIssue }}</template>
                        <template v-else-if="orderSide === 'sell'">Name any price. It waits on the book until someone takes it; anyone already bidding more fills you instantly.</template>
                        <template v-else>Name any price. It waits on the book until someone sells into it; anyone already asking less fills you instantly.</template>
                    </p>
                </section>

                <!-- My orders -->
                <section v-if="market && market.myOrders.length" class="mk-sec">
                    <header>Your open offers <span class="opacity-50">— what is still waiting on the book</span></header>
                    <div class="space-y-1">
                        <div v-for="o in market.myOrders" :key="o.id" class="mk-order" :class="o.side === 'sell' ? 'is-ask' : 'is-bid'">
                            <span class="mk-order-side">{{ o.side === 'sell' ? 'Selling' : 'Buying' }}</span>
                            <span class="mk-order-qty">
                                {{ formatNumber(o.quantity - o.filled) }} <TownAsset :id="resource.id" />
                                <small v-if="o.filled > 0">{{ formatNumber(o.filled) }} of {{ formatNumber(o.quantity) }} done</small>
                            </span>
                            <span class="mk-order-price">at <CoinBalance :value="o.price" :compact="o.price >= 1000" /> each</span>
                            <span class="mk-order-total">
                                <small>{{ o.side === 'sell' ? 'you get' : 'you pay' }}</small>
                                <CoinBalance :value="o.price * (o.quantity - o.filled)" />
                            </span>
                            <button class="g-icon g-icon-sm" :disabled="busy" title="Cancel and get it back" @click="emit('cancel-order', o.id)">✕</button>
                        </div>
                    </div>
                </section>

                <!-- Trades -->
                <section class="mk-sec">
                    <header>Recent trades</header>
                    <div v-if="market && market.trades.length" class="grid grid-cols-2 gap-x-4 gap-y-0.5">
                        <div v-for="(t, i) in market.trades.slice(0, 12)" :key="i" class="flex justify-between text-xs tabular-nums" :class="t.mine ? 'font-bold' : 'opacity-60'">
                            <span>{{ formatNumber(t.quantity) }} @ {{ fmtPrice(t.price) }}</span><span>{{ timeAgo(t.at) }} ago</span>
                        </div>
                    </div>
                    <div v-else class="py-2 text-center text-xs opacity-50">No trades yet</div>
                </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
.mk-list { width: 190px; flex-shrink: 0; overflow-y: auto; padding: 8px; border-right: 1px solid var(--g-line); display: flex; flex-direction: column; gap: 2px; }
.mk-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 10px; color: var(--g-text); background: transparent; border: 1px solid transparent; cursor: pointer; }
.mk-item:hover { background: rgba(255, 255, 255, 0.06); }
.mk-item.is-active { background: rgba(255, 255, 255, 0.1); border-color: var(--g-line); }
.mk-sep { height: 1px; margin: 4px 6px; background: var(--g-line); flex-shrink: 0; }
.mk-check { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 6px 10px; border-radius: 10px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--g-line); font-size: 12px; font-weight: 700; cursor: pointer; }
.mk-check input { accent-color: #b18cff; }
.mk-check > span:first-of-type { display: inline-flex; align-items: center; gap: 4px; }
.mk-ready { min-width: 20px; padding: 1px 6px; border-radius: 999px; background: rgba(177, 140, 255, 0.28); color: #e5d4ff; font-size: 10px; font-weight: 900; text-align: center; font-variant-numeric: tabular-nums; }
.mk-dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35); }
.mk-detail { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
.mk-legend { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; background: rgba(255, 255, 255, 0.08); border: 1px solid var(--g-line); color: var(--g-text); font-size: 11px; font-weight: 700; cursor: pointer; }
.mk-legend:hover { background: rgba(255, 255, 255, 0.14); }
.mk-legend.is-off { opacity: 0.4; }
.mk-legend.is-off .mk-dot { background: var(--g-muted) !important; }
.mk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mk-table { display: flex; flex-direction: column; gap: 2px; }
.mk-row { display: grid; grid-template-columns: minmax(0, 1.6fr) 0.8fr 0.9fr 0.7fr 1fr auto; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 8px; font-size: 12px; font-weight: 700; }
.mk-row:not(.mk-row-head):hover { background: rgba(255, 255, 255, 0.06); }
.mk-row-head { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.5; }
.mk-title { display: flex; align-items: center; gap: 14px; }
.mk-prices { display: flex; gap: 14px; }
.mk-prices span { display: flex; flex-direction: column; align-items: flex-end; }
.mk-prices i { font-style: normal; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.5; }
.mk-prices b { font-size: 14px; font-variant-numeric: tabular-nums; }
.mk-store { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--g-line); cursor: help; }
.mk-store-label { font-size: 12px; opacity: 0.7; }
.mk-store-bar { height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.mk-store-bar i { display: block; height: 100%; border-radius: 999px; transition: width 0.4s ease; }
.mk-store-bar i.ok { background: linear-gradient(90deg, #7ee081, #3ecf5a); }
.mk-store-bar i.meh { background: linear-gradient(90deg, #ffd479, #f5a623); }
.mk-store-bar i.bad { background: linear-gradient(90deg, #ff8a8a, #ff5252); }
.mk-store-num { font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
.mk-sec { padding: 12px 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--g-line); }
.mk-sec > header { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; opacity: 0.85; }
.mk-sec > header .opacity-50 { text-transform: none; letter-spacing: 0; font-weight: 600; }
.mk-book { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.mk-book-side { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mk-book-head, .mk-book-row { display: grid; grid-template-columns: minmax(58px, auto) 1fr 1fr auto; align-items: center; gap: 8px; padding: 5px 8px; }
.mk-book-head { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; padding-bottom: 2px; }
.mk-book-head.is-bid .mk-book-who { color: #9af0a8; opacity: 1; }
.mk-book-head.is-ask .mk-book-who { color: #ffb3b3; opacity: 1; }
.mk-book-row { position: relative; overflow: hidden; width: 100%; border-radius: 8px; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--g-text); background: rgba(255, 255, 255, 0.04); border: 1px solid transparent; cursor: pointer; text-align: left; }
.mk-book-row:hover { background: rgba(255, 255, 255, 0.1); border-color: var(--g-line); }
.mk-book-row.is-mine { border-color: rgba(255, 255, 255, 0.22); }
.mk-book-row > * { position: relative; }
.mk-depth { position: absolute !important; inset: 0 auto 0 0; pointer-events: none; opacity: 0.16; }
.mk-book-row.is-bid .mk-depth { background: linear-gradient(90deg, #4fd36a, transparent); }
.mk-book-row.is-ask .mk-depth { background: linear-gradient(90deg, #ff6b6b, transparent); }
.mk-book-who { display: flex; align-items: center; }
.mk-face { flex-shrink: 0; box-shadow: 0 0 0 2px rgba(20, 22, 28, 0.9); }
.mk-book-who > * + * { margin-left: -5px; }
.mk-face.is-me { box-shadow: 0 0 0 2px #facc15; }
.mk-face-more { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 999px; font-size: 9px; font-weight: 800; background: rgba(255, 255, 255, 0.18); }
.mk-book-price { display: flex; align-items: center; white-space: nowrap; }
.mk-book-row.is-bid .mk-book-price { color: #9af0a8; }
.mk-book-row.is-ask .mk-book-price { color: #ffb3b3; }
.mk-book-qty { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.mk-book-total { display: flex; justify-content: flex-end; white-space: nowrap; opacity: 0.75; }
.mk-book-empty { padding: 14px 8px; text-align: center; font-size: 12px; opacity: 0.5; border-radius: 8px; border: 1px dashed var(--g-line); }
.mk-toggle { display: inline-flex; padding: 2px; border-radius: 8px; background: rgba(0, 0, 0, 0.25); }
.mk-toggle button { padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; color: var(--g-muted); background: transparent; border: none; cursor: pointer; text-transform: none; letter-spacing: 0; }
.mk-toggle button.is-on { background: rgba(255, 255, 255, 0.16); color: var(--g-text); }
.mk-toggle button.is-sell { background: rgba(255, 107, 107, 0.25); color: #ffb3b3; }
.mk-toggle button.is-buy { background: rgba(79, 211, 106, 0.25); color: #9af0a8; }
.mk-order { display: grid; grid-template-columns: auto 1fr auto auto auto; align-items: center; gap: 12px; padding: 6px 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.06); border-left: 3px solid transparent; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mk-order.is-bid { border-left-color: #4fd36a; }
.mk-order.is-ask { border-left-color: #ff6b6b; }
.mk-order.is-bid .mk-order-side { color: #9af0a8; }
.mk-order.is-ask .mk-order-side { color: #ffb3b3; }
.mk-order-side { min-width: 50px; }
.mk-order-qty { display: flex; align-items: center; gap: 5px; }
.mk-order-qty small, .mk-order-total small { font-size: 10px; font-weight: 600; opacity: 0.55; }
.mk-order-price { display: flex; align-items: center; gap: 4px; white-space: nowrap; opacity: 0.85; }
.mk-order-total { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
:global(.town-root .g-input) { padding: 7px 10px; border-radius: 10px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--g-line); color: var(--g-text); font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; outline: none; }
:global(.town-root .g-input:focus) { border-color: rgba(255, 255, 255, 0.35); }
</style>
