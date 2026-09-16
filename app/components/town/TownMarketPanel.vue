<script setup lang="ts">
import TownCoin from '~/components/town/TownCoin.vue'
import TownAsset from '~/components/town/TownAsset.vue'
import TownProductionChart from '~/components/town/TownProductionChart.vue'
import type { TownResourceView, TownOrderView } from '~/composables/useTown'
import { TOWN_MARKET_MIN_PRICE, TOWN_MAX_ORDER_PRICE } from '#shared/utils/gamelogic/town'

interface BookPlayer { id: string, name: string, emblem: string | null, quantity: number, mine: boolean }
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
const convertQtyText = useAmountInput(convertQty, { integer: true })
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
const orderPriceText = useAmountInput(orderPrice)
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
            <h2><UIcon name="i-lucide-store" class="mk-title-ico" /> Market</h2>
            <button class="g-icon g-icon-sm" aria-label="Close" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
        </div>

        <div class="flex min-h-0 flex-1">
            <!-- Resource list -->
            <div class="mk-list">
                <button class="mk-item is-meta" :class="isAll ? 'is-on' : ''" @click="selected = ALL">
                    <UIcon name="i-lucide-chart-line" class="mk-item-ico" />
                    <span class="mk-item-name">All</span>
                </button>
                <button class="mk-item is-meta" :class="isGems ? 'is-on' : ''" @click="selected = GEMS">
                    <UIcon name="i-lucide-gem" class="mk-item-ico is-gem" />
                    <span class="mk-item-name">Gems</span>
                    <span v-if="gemsReady > 0" class="g-tag g-tag-gem mk-ready">{{ gemsReady }}</span>
                </button>

                <div class="mk-list-gap" />
                <button
                    v-for="r in resources"
                    :key="r.id"
                    class="mk-item"
                    :class="selected === r.id ? 'is-on' : ''"
                    @click="selected = r.id"
                >
                    <TownAsset :id="r.id" class="mk-item-art" />
                    <span class="mk-item-name">{{ r.name }}</span>
                    <span class="mk-item-owned">{{ formatNumber(inventory[r.id] ?? 0) }}</span>
                    <span class="mk-item-last"><TownCoin /> {{ fmtPrice(lastPrices[r.id] ?? r.floorPrice) }}</span>
                </button>
            </div>

            <!-- Overview -->
            <div v-if="isAll" class="mk-detail">
                <section class="g-sec">
                    <header>
                        <span data-tip="Units made per hour.">Production</span>
                        <span class="mk-seg">
                            <button v-for="r in RANGES" :key="r.hours" :class="rangeHours === r.hours ? 'is-on' : ''" @click="rangeHours = r.hours">{{ r.label }}</button>
                        </span>
                    </header>

                    <div v-if="prodLoading && !production" class="mk-loading"><span class="g-spinner" /></div>
                    <div v-else-if="!producedSeries.length" class="g-empty">Nothing produced yet — build a farm</div>
                    <template v-else>
                        <TownProductionChart
                            :buckets="production?.buckets ?? []"
                            :series="visibleSeries"
                            :colors="RESOURCE_COLORS"
                            :names="resourceNames"
                            :hours="rangeHours"
                        />
                        <div class="mk-legend">
                            <button
                                v-for="id in producedSeries"
                                :key="id"
                                class="mk-chip"
                                :class="hiddenSeries.has(id) ? 'is-off' : ''"
                                @click="toggleSeries(id)"
                            >
                                <span class="mk-dot" :style="{ background: colorFor(id) }" />
                                {{ resourceNames[id] ?? id }}
                            </button>
                        </div>
                    </template>
                </section>

                <section class="g-sec">
                    <header>
                        <span data-tip="Best offers first, the town hall for the rest — in one go.">Sell in bulk</span>
                        <label
                            v-if="heldBack.length"
                            class="mk-check"
                            :data-tip="`${heldBack.map(r => r.name).join(', ')} are worth far more as gems — ${formatNumber(heldBackOwned)} held.`"
                        >
                            <input v-model="includeHeld" type="checkbox">
                            <span>Include <template v-for="(r, i) in heldBack" :key="r.id"><template v-if="i">, </template>{{ r.name }}</template></span>
                        </label>
                    </header>

                    <div v-if="!ownedRows.length" class="g-empty">Your warehouse is empty</div>
                    <template v-else>
                        <div class="mk-bar">
                            <span class="g-label">Sell</span>
                            <span class="mk-group">
                                <button
                                    v-for="q in quickSells"
                                    :key="q.fraction"
                                    :disabled="busy || q.value <= 0"
                                    :data-tip="`At least ${formatNumber(q.value)} coins`"
                                    @click="sellItems(q.items)"
                                >{{ q.label }}</button>
                            </span>
                            <span class="mk-divider" />
                            <span class="g-label" data-tip="Leaves this many of each good in store.">Keep</span>
                            <input v-model.number="keep" type="number" min="0" class="g-input mk-qty">
                            <button class="g-btn g-btn-primary g-btn-sm" :disabled="busy || keepSell.value <= 0" @click="sellItems(keepSell.items)">
                                Sell rest <b>≥ <TownCoin /> {{ formatNumber(keepSell.value) }}</b>
                            </button>
                        </div>

                        <div class="mk-table">
                            <div class="mk-row is-head">
                                <span class="g-label">Good</span>
                                <span class="g-label">Owned</span>
                                <span class="g-label">Rate</span>
                                <span class="g-label">Hall pays</span>
                                <span class="g-label">Worth</span>
                                <span />
                            </div>
                            <div v-for="r in ownedRows" :key="r.id" class="mk-row">
                                <span class="mk-cell-name">
                                    <span class="mk-dot" :style="{ background: colorFor(r.id) }" />
                                    <TownAsset :id="r.id" class="mk-item-art" />
                                    <span class="truncate">{{ r.name }}</span>
                                </span>
                                <span class="mk-num">{{ formatNumber(r.owned) }}</span>
                                <span class="mk-num" :class="r.perHour > 0 ? 'is-up' : r.perHour < 0 ? 'is-down' : ''">{{ fmtRate(r.perHour) }}</span>
                                <span class="mk-num is-soft">{{ fmtPrice(r.floor) }}</span>
                                <span class="mk-num"><TownCoin /> {{ formatNumber(r.owned * r.floor) }}</span>
                                <span class="mk-cell-act">
                                    <button class="g-btn g-btn-xs" :disabled="busy" @click="sellItems([{ resource: r.id, quantity: r.owned }])">Sell all</button>
                                </span>
                            </div>
                        </div>
                    </template>
                </section>
            </div>

            <!-- Gems -->
            <div v-else-if="isGems" class="mk-detail">
                <div class="mk-head">
                    <TownAsset id="jewels" class="mk-art" />
                    <div class="min-w-0 flex-1">
                        <h3 class="mk-name">Gems</h3>
                        <p class="mk-sub">{{ jewelsPerGem }} jewels make one gem</p>
                    </div>
                </div>

                <div class="mk-stats">
                    <div class="mk-stat">
                        <span class="g-label">Jewels held</span>
                        <b>{{ formatNumber(jewels) }}</b>
                    </div>
                    <div class="mk-stat">
                        <span class="g-label">Gems ready</span>
                        <b class="is-gem"><UIcon name="i-lucide-gem" class="mk-i" /> {{ formatNumber(gemsReady) }}</b>
                    </div>
                    <div class="mk-stat">
                        <span class="g-label">Digging</span>
                        <b :class="jewelsPerDay > 0 ? 'is-up' : ''">{{ jewelsPerDay > 0 ? `+${Math.round(jewelsPerDay * 10) / 10}/day` : '—' }}</b>
                    </div>
                </div>

                <div class="mk-store" data-tip="Full storage stops the mines until you convert or sell.">
                    <span class="g-label"><UIcon name="i-lucide-package" class="mk-i" /> Storage</span>
                    <span class="g-meter"><i :class="jewelClass" :style="{ width: `${Math.round(jewelRatio * 100)}%` }" /></span>
                    <b class="mk-store-num">{{ formatNumber(jewels) }}<span class="is-soft">/{{ formatNumber(storageCap) }}</span><span v-if="jewelFullDays !== null" class="mk-store-eta">full in {{ fmtDays(jewelFullDays) }}</span></b>
                </div>

                <section class="g-sec">
                    <header><span data-tip="Whole gems only, straight to your balance.">Convert</span></header>
                    <div v-if="jewelsPerDay <= 0 && jewels <= 0" class="g-empty">No jewel mine yet — it is a tier-2 build</div>
                    <template v-else>
                        <div class="mk-bar">
                            <input v-model="convertQtyText" autocomplete="off" class="g-input mk-qty">
                            <button class="g-btn g-btn-sm" :disabled="gemsReady < 1" @click="convertQty = gemsReady">All</button>
                            <span class="mk-num is-soft">= {{ formatNumber(Math.max(0, Math.floor(convertQty || 0)) * jewelsPerGem) }} <TownAsset id="jewels" class="mk-item-art" /></span>
                            <span class="mk-grow" />
                            <button class="g-btn g-btn-gem" :disabled="busy || !convertValid" @click="convert">
                                <UIcon name="i-lucide-gem" class="mk-i" /> Convert {{ convertValid ? Math.floor(convertQty) : '' }}
                            </button>
                        </div>
                        <p v-if="gemsReady < 1" class="mk-note">{{ formatNumber(jewelsPerGem - (jewels % jewelsPerGem)) }} more jewels until the next gem</p>
                    </template>
                </section>
            </div>

            <!-- Detail -->
            <div v-else-if="resource" class="mk-detail">
                <div class="mk-head">
                    <TownAsset :id="resource.id" class="mk-art" />
                    <div class="min-w-0 flex-1">
                        <h3 class="mk-name">{{ resource.name }}</h3>
                        <p class="mk-sub">Tier {{ resource.tier }} · {{ formatNumber(owned) }} owned</p>
                    </div>
                </div>

                <div class="mk-stats">
                    <div class="mk-stat">
                        <span class="g-label">Last price</span>
                        <b v-if="lastPrices[resource.id]" class="is-gold"><TownCoin /> {{ fmtPrice(lastPrices[resource.id]!) }}</b>
                        <b v-else class="is-soft">—</b>
                    </div>
                    <div class="mk-stat" data-tip="What the town hall always pays.">
                        <span class="g-label">Hall floor</span>
                        <b><TownCoin /> {{ fmtPrice(resource.floorPrice) }}</b>
                    </div>
                    <div class="mk-stat">
                        <span class="g-label">You own</span>
                        <b>{{ formatNumber(owned) }}</b>
                    </div>
                </div>

                <!-- Storage: full storage halts every workshop that makes this. -->
                <div class="mk-store" :data-tip="storeFull ? 'Over the cap — the workshops that make this have stopped until you are back under.' : 'Build warehouses to hold more. Production stops at the cap.'">
                    <span class="g-label"><UIcon name="i-lucide-package" class="mk-i" /> Storage</span>
                    <span class="g-meter"><i :class="storeClass" :style="{ width: `${Math.round(storeRatio * 100)}%` }" /></span>
                    <b class="mk-store-num">{{ formatNumber(owned) }}<span class="is-soft">/{{ formatNumber(storageCap) }}</span></b>
                </div>

                <!-- Instant trade -->
                <section class="g-sec">
                    <header><span data-tip="Selling takes the best offers first, then the town hall.">Trade now</span></header>
                    <div class="mk-bar">
                        <input v-model.number="quickQty" type="number" min="1" class="g-input mk-qty">
                        <button class="g-btn g-btn-sm" @click="quickQty = owned">All</button>
                        <span class="mk-grow" />
                        <button class="g-btn g-btn-primary" :disabled="busy || owned < 1 || quickQty < 1 || quickQty > owned" @click="emit('sell-floor', resource.id, Math.floor(quickQty))">
                            Sell · <TownCoin /> {{ formatNumber(sellQuote.total) }}
                        </button>
                        <button
                            class="g-btn"
                            :class="buyQuote ? '' : 'g-btn-ghost'"
                            :disabled="busy || !buyQuote || buyQuote.cost > balance"
                            :data-tip="buyQuote ? 'Fills against the cheapest offers on sale' : 'Nothing on sale — place a buy offer below'"
                            @click="buyQuote && emit('place-order', resource.id, 'buy', buyQuote.worstPrice, Math.floor(quickQty))"
                        >
                            <span v-if="buyQuote">Buy · <TownCoin /> {{ formatNumber(buyQuote.cost) }}</span>
                            <span v-else>Nothing on sale</span>
                        </button>
                    </div>
                    <p class="mk-note" :class="quickQty > owned ? 'is-bad' : ''">
                        <template v-if="quickQty > owned">You only have {{ formatNumber(owned) }}</template>
                        <template v-else-if="sellQuote.toPlayers > 0">{{ formatNumber(sellQuote.toPlayers) }} to mayors at up to {{ fmtPrice(sellQuote.best) }}, the rest to the hall at {{ fmtPrice(sellQuote.floor) }}</template>
                        <template v-else>All to the town hall at {{ fmtPrice(sellQuote.floor) }}</template>
                    </p>
                </section>

                <!-- Order book -->
                <section class="g-sec">
                    <header><span data-tip="One row per price. Click a row to trade against it — a gold ring marks your own offers.">Player offers</span></header>
                    <div class="mk-book">
                        <div class="mk-book-side">
                            <div class="mk-book-head is-bid">
                                <span class="g-label is-bid">Buyers</span>
                                <span class="g-label">Pays each</span>
                                <span class="g-label">Wants</span>
                                <span class="g-label mk-right">Total</span>
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
                                            <span class="mk-face" :class="{ 'is-me': p.mine }"><ProfileEmblem :emblem="p.emblem" :name="p.name" /></span>
                                        </UTooltip>
                                        <UTooltip v-if="lvl.players.length > 3" :text="lvl.players.slice(3).map(p => p.name).join(', ')">
                                            <span class="mk-face mk-face-more">+{{ lvl.players.length - 3 }}</span>
                                        </UTooltip>
                                    </span>
                                    <span class="mk-book-price"><CoinBalance :value="lvl.price" :compact="lvl.price >= 1000" /></span>
                                    <span class="mk-book-qty">{{ formatNumber(lvl.quantity) }} <TownAsset :id="resource.id" class="mk-item-art" /></span>
                                    <span class="mk-book-total"><CoinBalance :value="lvl.price * lvl.quantity" /></span>
                                </button>
                            </template>
                            <div v-else class="g-empty">{{ loading && !market ? '…' : 'Nobody is buying' }}</div>
                        </div>

                        <div class="mk-book-side">
                            <div class="mk-book-head is-ask">
                                <span class="g-label is-ask">Sellers</span>
                                <span class="g-label">Asks each</span>
                                <span class="g-label">Sells</span>
                                <span class="g-label mk-right">Total</span>
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
                                            <span class="mk-face" :class="{ 'is-me': p.mine }"><ProfileEmblem :emblem="p.emblem" :name="p.name" /></span>
                                        </UTooltip>
                                        <UTooltip v-if="lvl.players.length > 3" :text="lvl.players.slice(3).map(p => p.name).join(', ')">
                                            <span class="mk-face mk-face-more">+{{ lvl.players.length - 3 }}</span>
                                        </UTooltip>
                                    </span>
                                    <span class="mk-book-price"><CoinBalance :value="lvl.price" :compact="lvl.price >= 1000" /></span>
                                    <span class="mk-book-qty">{{ formatNumber(lvl.quantity) }} <TownAsset :id="resource.id" class="mk-item-art" /></span>
                                    <span class="mk-book-total"><CoinBalance :value="lvl.price * lvl.quantity" /></span>
                                </button>
                            </template>
                            <div v-else class="g-empty">{{ loading && !market ? '…' : 'Nobody is selling' }}</div>
                        </div>
                    </div>
                </section>

                <!-- Place order -->
                <section class="g-sec">
                    <header>
                        <span>Your offer</span>
                        <span class="mk-seg">
                            <button :class="orderSide === 'sell' ? 'is-sell' : ''" @click="orderSide = 'sell'">Sell</button>
                            <button :class="orderSide === 'buy' ? 'is-buy' : ''" @click="orderSide = 'buy'">Buy</button>
                        </span>
                    </header>
                    <div class="mk-bar">
                        <span class="g-label">Price each</span>
                        <input v-model="orderPriceText" autocomplete="off" class="g-input mk-price">
                        <span v-if="amountPreview(orderPriceText)" class="mk-num is-soft">{{ amountPreview(orderPriceText) }}</span>
                        <span class="g-label">×</span>
                        <input v-model.number="orderQty" type="number" min="1" class="g-input mk-qty">
                        <button v-if="orderSide === 'sell'" class="g-btn g-btn-sm" @click="orderQty = owned">All</button>
                        <span class="mk-grow" />
                        <span class="mk-total"><span class="g-label">Total</span><CoinBalance :value="orderTotal" /></span>
                        <span v-if="orderIssue" class="mk-issue">{{ orderIssue }}</span>
                        <button class="g-btn" :class="orderSide === 'sell' ? 'g-btn-danger' : 'g-btn-primary'" :disabled="busy || !orderValid" @click="emit('place-order', resource.id, orderSide, orderPrice, Math.floor(orderQty))">
                            {{ orderSide === 'sell' ? 'List for sale' : 'Place buy offer' }}
                        </button>
                    </div>
                </section>

                <!-- My orders -->
                <section v-if="market && market.myOrders.length" class="g-sec">
                    <header><span>Your open offers</span></header>
                    <div class="mk-table">
                        <div v-for="o in market.myOrders" :key="o.id" class="mk-order">
                            <span class="g-tag" :class="o.side === 'sell' ? 'g-tag-red' : 'g-tag-green'">{{ o.side === 'sell' ? 'Selling' : 'Buying' }}</span>
                            <span class="mk-order-qty">
                                {{ formatNumber(o.quantity - o.filled) }} <TownAsset :id="resource.id" class="mk-item-art" />
                                <small v-if="o.filled > 0">{{ formatNumber(o.filled) }} of {{ formatNumber(o.quantity) }} done</small>
                            </span>
                            <span class="mk-num is-soft">at <CoinBalance :value="o.price" :compact="o.price >= 1000" /> each</span>
                            <span class="mk-order-total">
                                <span class="g-label">{{ o.side === 'sell' ? 'You get' : 'You pay' }}</span>
                                <CoinBalance :value="o.price * (o.quantity - o.filled)" />
                            </span>
                            <button class="g-icon g-icon-sm" :disabled="busy" data-tip="Cancel and get it back" aria-label="Cancel offer" @click="emit('cancel-order', o.id)">
                                <UIcon name="i-lucide-x" />
                            </button>
                        </div>
                    </div>
                </section>

                <!-- Trades -->
                <section class="g-sec">
                    <header><span>Recent trades</span></header>
                    <div v-if="market && market.trades.length" class="mk-trades">
                        <div v-for="(t, i) in market.trades.slice(0, 12)" :key="i" class="mk-trade" :class="t.mine ? 'is-mine' : ''">
                            <span>{{ formatNumber(t.quantity) }} @ {{ fmtPrice(t.price) }}</span>
                            <span class="is-soft">{{ timeAgo(t.at) }} ago</span>
                        </div>
                    </div>
                    <div v-else class="g-empty">No trades yet</div>
                </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* ── shell ── */
.mk-title-ico { width: 18px; height: 18px; vertical-align: -0.18em; color: var(--g-muted); }
.mk-detail { flex: 1; min-width: 0; overflow-x: hidden; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }

/* ── left type list ── */
.mk-list { width: 236px; flex-shrink: 0; overflow-y: auto; overflow-x: hidden; padding: 8px; border-right: 1px solid var(--g-line); display: flex; flex-direction: column; }
.mk-list-gap { height: 10px; flex-shrink: 0; }
.mk-item {
    position: relative; display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto;
    align-items: center; gap: 8px; height: 36px; padding: 0 10px;
    border-radius: var(--g-radius-sm); border: none; text-align: left;
    color: var(--g-text-2); background: transparent; cursor: pointer;
}
.mk-item.is-meta { grid-template-columns: 24px minmax(0, 1fr) auto; }
.mk-item:hover { background: var(--g-fill); color: var(--g-text); }
.mk-item.is-on { background: var(--g-fill-2); color: var(--g-text); }
.mk-item.is-on::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; border-radius: 2px; background: var(--g-accent); }
.mk-item-ico { width: 16px; height: 16px; justify-self: center; color: var(--g-muted); }
.mk-item-ico.is-gem { color: var(--g-gem); }
.mk-item.is-on .mk-item-ico { color: var(--g-accent); }
.mk-item-art { width: 18px; height: 18px; }
.mk-item > .mk-item-art { width: 20px; height: 20px; justify-self: center; }
.mk-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.mk-item-owned, .mk-item-last { font-size: 11.5px; text-align: right; white-space: nowrap; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.mk-item-last { display: inline-flex; align-items: center; gap: 3px; }
.mk-ready { font-variant-numeric: tabular-nums; }

/* ── section headers, shared bits ── */
.g-sec > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.mk-grow { flex: 1; }
.mk-right { text-align: right; }
.is-soft { color: var(--g-muted); }
.is-up { color: var(--g-green); }
.is-down { color: var(--g-red); }
.is-gold { color: var(--g-gold); }
.is-gem { color: var(--g-gem); }
.mk-note { margin-top: 6px; font-size: 11.5px; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.mk-note.is-bad { color: var(--g-red); }
.mk-loading { display: flex; justify-content: center; padding: 40px 0; }
.mk-dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; box-shadow: 0 0 0 1px var(--g-line-2); }
.mk-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mk-divider { width: 1px; align-self: stretch; margin: 0 2px; background: var(--g-line); }
.mk-qty { width: 76px; }
.mk-price { width: 96px; }

/* ── segmented control ── */
.mk-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--g-radius-sm); background: var(--g-fill-2); }
.mk-seg button {
    padding: 3px 10px; border: 1px solid transparent; border-radius: var(--g-radius-xs);
    font-size: 11px; font-weight: 600; letter-spacing: 0; text-transform: none;
    color: var(--g-muted); background: transparent; cursor: pointer; font-variant-numeric: tabular-nums;
}
.mk-seg button:hover { color: var(--g-text); }
.mk-seg button.is-on { background: var(--g-bg-2); border-color: var(--g-line); color: var(--g-text); }
.mk-seg button.is-sell { background: var(--g-red-bg); color: var(--g-red); }
.mk-seg button.is-buy { background: var(--g-green-bg); color: var(--g-green); }

/* ── attached button group ── */
.mk-group { display: inline-flex; border: 1px solid var(--g-line); border-radius: var(--g-radius-sm); background: var(--g-fill); }
.mk-group button {
    height: 28px; padding: 0 11px; border: none; border-left: 1px solid var(--g-line);
    font-size: 12px; font-weight: 600; color: var(--g-text-2); background: transparent; cursor: pointer;
    font-variant-numeric: tabular-nums;
}
.mk-group button:first-child { border-left: none; border-radius: var(--g-radius-sm) 0 0 var(--g-radius-sm); }
.mk-group button:last-child { border-radius: 0 var(--g-radius-sm) var(--g-radius-sm) 0; }
.mk-group button:hover:not(:disabled) { background: var(--g-fill-2); color: var(--g-text); }
.mk-group button:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── legend chips ── */
.mk-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.mk-chip {
    display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px;
    border: 1px solid var(--g-line); border-radius: 999px; background: var(--g-fill);
    color: var(--g-text-2); font-size: 11px; font-weight: 600; cursor: pointer;
}
.mk-chip:hover { background: var(--g-fill-2); color: var(--g-text); }
.mk-chip.is-off { opacity: 0.45; }
.mk-chip.is-off .mk-dot { background: var(--g-muted) !important; }

/* ── tables ── */
.mk-table { display: flex; flex-direction: column; margin-top: 10px; }
.mk-row { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, auto); align-items: center; gap: 10px; padding: 7px 2px; border-top: 1px solid var(--g-line); font-size: 12.5px; }
.mk-row.is-head { padding: 0 2px 6px; border-top: none; }
.mk-row:not(.is-head):hover { background: var(--g-fill); }
.mk-row.is-head > .g-label:not(:first-child) { text-align: right; }
.mk-cell-name { display: flex; min-width: 0; align-items: center; gap: 8px; font-weight: 600; }
.mk-cell-act { text-align: right; }
.mk-num { display: flex; align-items: center; justify-content: flex-end; gap: 4px; white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── checkbox ── */
.mk-check { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--g-muted); cursor: pointer; }
.mk-check input { width: 13px; height: 13px; accent-color: var(--g-accent); cursor: pointer; }
.mk-check:hover { color: var(--g-text-2); }

/* ── title block ── */
.mk-head { display: flex; align-items: center; gap: 14px; }
.mk-art { width: 44px; height: 44px; }
.mk-name { font-family: var(--g-font-display); font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; }
.mk-sub { font-size: 12px; color: var(--g-muted); font-variant-numeric: tabular-nums; }

/* ── stat cells ── */
.mk-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.mk-stat > * { min-width: 0; }
.mk-stat { display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; border: 1px solid var(--g-line); border-radius: var(--g-radius-sm); background: var(--g-fill); }
.mk-stat b { display: flex; align-items: center; gap: 5px; font-size: 18px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.mk-i { width: 14px; height: 14px; flex-shrink: 0; }

/* ── storage row ── */
.mk-store { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 9px 12px; border: 1px solid var(--g-line); border-radius: var(--g-radius-sm); background: var(--g-fill); cursor: help; }
.mk-store .g-label { display: inline-flex; align-items: center; gap: 5px; }
.mk-store .g-meter { height: 6px; border-radius: 999px; background: var(--g-fill-2); overflow: hidden; }
.mk-store .g-meter > i { display: block; height: 100%; border-radius: inherit; transition: width 0.4s ease; }
.mk-store .g-meter > i.ok { background: var(--g-green); }
.mk-store .g-meter > i.meh { background: var(--g-warn); }
.mk-store .g-meter > i.bad { background: var(--g-red); }
.mk-store-num { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mk-store-eta { margin-left: 8px; color: var(--g-muted); }

/* ── order book ── */
.mk-book { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
.mk-book-side { min-width: 0; display: flex; flex-direction: column; }
.mk-book-head, .mk-book-row { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr) minmax(0, 1fr) minmax(0, auto); align-items: center; gap: 8px; padding: 6px 6px; }
.mk-book-head > *, .mk-book-row > * { min-width: 0; overflow: hidden; }
.mk-book-head { padding-top: 0; padding-bottom: 5px; }
.mk-book-head > .g-label:nth-child(2), .mk-book-head > .g-label:nth-child(3) { text-align: right; }
.mk-book-head .g-label.is-bid { color: var(--g-green); }
.mk-book-head .g-label.is-ask { color: var(--g-red); }
.mk-book-row {
    position: relative; overflow: hidden; width: 100%; text-align: left; cursor: pointer;
    border: none; border-top: 1px solid var(--g-line); border-left: 2px solid transparent;
    background: transparent; color: var(--g-text-2);
    font-size: 12.5px; font-variant-numeric: tabular-nums;
}
.mk-book-row:hover { background: var(--g-fill); color: var(--g-text); }
.mk-book-row.is-mine { border-left-color: var(--g-gold); }
.mk-book-row > * { position: relative; }
.mk-depth { position: absolute !important; inset: 0 auto 0 0; pointer-events: none; }
.mk-book-row.is-bid .mk-depth { background: var(--g-green-bg); }
.mk-book-row.is-ask .mk-depth { background: var(--g-red-bg); }
.mk-book-who { display: flex; align-items: center; }
.mk-book-who > * + * { margin-left: -5px; }
.mk-face { display: inline-flex; width: 20px; height: 20px; flex-shrink: 0; border-radius: 999px; font-size: 9px; box-shadow: 0 0 0 2px var(--g-bg-2); }
.mk-face.is-me { box-shadow: 0 0 0 2px var(--g-gold); }
.mk-face-more { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 999px; font-size: 9px; font-weight: 700; color: var(--g-text-2); background: var(--g-fill-2); box-shadow: 0 0 0 2px var(--g-bg-2); }
.mk-book-price { display: flex; align-items: center; justify-content: flex-end; white-space: nowrap; font-weight: 600; }
.mk-book-row.is-bid .mk-book-price { color: var(--g-green); }
.mk-book-row.is-ask .mk-book-price { color: var(--g-red); }
.mk-book-qty { display: flex; align-items: center; justify-content: flex-end; gap: 4px; white-space: nowrap; }
.mk-book-total { display: flex; justify-content: flex-end; white-space: nowrap; color: var(--g-muted); }

/* ── your offer ── */
.mk-total { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mk-issue { font-size: 11.5px; color: var(--g-red); }

/* ── open offers ── */
.mk-order { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr) minmax(0, auto) minmax(0, auto) minmax(0, auto); align-items: center; gap: 12px; padding: 6px 2px; border-top: 1px solid var(--g-line); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.mk-order:first-child { border-top: none; }
.mk-order-qty { display: flex; align-items: center; gap: 5px; font-weight: 600; }
.mk-order-qty small { font-size: 10.5px; font-weight: 500; color: var(--g-muted); }
.mk-order-total { display: flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 600; }
.mk-order > * { min-width: 0; }

/* ── recent trades ── */
.mk-trades { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 20px; margin-top: 8px; }
.mk-trade { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; border-top: 1px solid var(--g-line); font-size: 12px; color: var(--g-text-2); font-variant-numeric: tabular-nums; }
.mk-trade:first-child, .mk-trade:nth-child(2) { border-top: none; }
.mk-trade.is-mine { color: var(--g-text); font-weight: 600; }
</style>
