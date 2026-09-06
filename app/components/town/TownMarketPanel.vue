<script setup lang="ts">
import TownAsset from '~/components/town/TownAsset.vue'
import type { TownResourceView, TownOrderView } from '~/composables/useTown'

interface BookLevel { price: number, quantity: number }
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

const props = defineProps<{
    resources: TownResourceView[]
    inventory: Record<string, number>
    lastPrices: Record<string, number>
    myOrders: TownOrderView[]
    balance: number
    initialResource: string | null
    busy: boolean
}>()

const emit = defineEmits<{
    close: []
    'sell-floor': [resource: string, quantity: number]
    'place-order': [resource: string, side: 'buy' | 'sell', price: number, quantity: number]
    'cancel-order': [orderId: string]
}>()

const selected = ref<string>(props.initialResource ?? props.resources[0]?.id ?? 'wheat')
watch(() => props.initialResource, (r) => { if (r) selected.value = r })

const resource = computed(() => props.resources.find(r => r.id === selected.value) ?? null)
const owned = computed(() => props.inventory[selected.value] ?? 0)

const market = ref<MarketData | null>(null)
const loading = ref(false)
let fetchSeq = 0

async function loadMarket() {
    const id = selected.value
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

// Live invalidation: the server pings which resource book changed.
let ws: WebSocket | null = null
let unmounted = false
function connect() {
    if (unmounted || ws || !import.meta.client) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/town/ws`)
    ws.onmessage = (ev) => {
        try {
            const msg = JSON.parse(String(ev.data)) as { type?: string, resource?: string }
            if (msg.type === 'market' && msg.resource === selected.value) loadMarket()
        } catch { /* ignore */ }
    }
    ws.onclose = () => {
        ws = null
        if (!unmounted) setTimeout(connect, 2000)
    }
}
onMounted(connect)
onBeforeUnmount(() => {
    unmounted = true
    ws?.close()
})

// ── Quick trade with the system ──
const quickQty = ref(1)
watch(selected, () => { quickQty.value = Math.min(Math.max(1, owned.value), 100) })
const sellTotal = computed(() => (resource.value?.floorPrice ?? 0) * Math.max(0, Math.floor(quickQty.value || 0)))
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
const orderValid = computed(() => {
    if (!market.value) return false
    const p = orderPrice.value
    const q = Math.floor(orderQty.value || 0)
    if (!Number.isFinite(p) || p < market.value.floor || p > market.value.ceiling) return false
    if (q < 1) return false
    if (orderSide.value === 'sell' && q > owned.value) return false
    if (orderSide.value === 'buy' && orderTotal.value > props.balance) return false
    return true
})

function fillFromLevel(side: 'buy' | 'sell', level: BookLevel) {
    // Clicking an ask = you buy at that price; clicking a bid = you sell into it.
    orderSide.value = side === 'sell' ? 'buy' : 'sell'
    orderPrice.value = level.price
    orderQty.value = Math.max(1, Math.min(level.quantity, orderSide.value === 'sell' ? owned.value || 1 : level.quantity))
}

function fmtPrice(p: number) {
    return p >= 1000 ? formatNumber(p) : p.toFixed(2).replace(/\.00$/, '')
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
                <button v-for="r in resources" :key="r.id" class="mk-item" :class="selected === r.id ? 'is-active' : ''" @click="selected = r.id">
                    <span class="text-lg leading-none"><TownAsset :id="r.id" /></span>
                    <span class="min-w-0 flex-1 text-left">
                        <span class="block truncate text-sm font-bold leading-tight">{{ r.name }}</span>
                        <span class="block text-[11px] leading-tight opacity-60 tabular-nums">{{ formatNumber(inventory[r.id] ?? 0) }} owned</span>
                    </span>
                    <span class="text-[11px] opacity-50 tabular-nums">{{ fmtPrice(lastPrices[r.id] ?? r.floorPrice) }}</span>
                </button>
            </div>

            <!-- Detail -->
            <div v-if="resource" class="mk-detail">
                <div class="mk-title">
                    <span class="text-4xl drop-shadow"><TownAsset :id="resource.id" /></span>
                    <div class="flex-1">
                        <div class="text-lg font-black leading-tight">{{ resource.name }}</div>
                        <div class="text-xs opacity-60">Tier {{ resource.tier }} · you own <b class="opacity-100">{{ formatNumber(owned) }}</b></div>
                    </div>
                    <div class="mk-prices">
                        <span><i>Floor</i><b>{{ fmtPrice(resource.floorPrice) }}</b></span>
                        <span v-if="lastPrices[resource.id]"><i>Last</i><b style="color: var(--g-gold)">{{ fmtPrice(lastPrices[resource.id]!) }}</b></span>
                        <span><i>Max offer</i><b>{{ fmtPrice(resource.ceilingPrice) }}</b></span>
                    </div>
                </div>

                <!-- Instant trade -->
                <section class="mk-sec">
                    <header>Quick trade <span class="opacity-50">— the town hall always buys at floor; buying takes another player's offer</span></header>
                    <div class="flex flex-wrap items-center gap-2">
                        <input v-model.number="quickQty" type="number" min="1" class="g-input w-24">
                        <button class="g-btn py-2 text-xs" @click="quickQty = owned">All</button>
                        <div class="flex-1" />
                        <button class="g-btn g-btn-primary py-2" :disabled="busy || owned < 1 || quickQty < 1 || quickQty > owned" @click="emit('sell-floor', resource.id, Math.floor(quickQty))">
                            Sell to town hall · 🪙 {{ formatNumber(sellTotal) }}
                        </button>
                        <button
                            class="g-btn py-2"
                            :disabled="busy || !buyQuote || buyQuote.cost > balance"
                            :title="buyQuote ? 'Fills against the cheapest player offers' : 'Not enough on offer — place a buy offer below'"
                            @click="buyQuote && emit('place-order', resource.id, 'buy', buyQuote.worstPrice, Math.floor(quickQty))"
                        >
                            <span v-if="buyQuote">Buy from players · 🪙 {{ formatNumber(buyQuote.cost) }}</span>
                            <span v-else>Nobody selling</span>
                        </button>
                    </div>
                </section>

                <!-- Order book -->
                <section class="mk-sec">
                    <header>Player offers <span class="opacity-50">— click a row to trade against it</span></header>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <div class="mk-colhead"><span>Buyers</span><span style="color: var(--g-green)">bid · qty</span></div>
                            <div v-if="market && market.bids.length" class="space-y-0.5">
                                <button v-for="lvl in market.bids" :key="lvl.price" class="mk-lvl is-bid" @click="fillFromLevel('buy', lvl)">
                                    <span>{{ fmtPrice(lvl.price) }}</span><span class="opacity-60">{{ formatNumber(lvl.quantity) }}</span>
                                </button>
                            </div>
                            <div v-else class="py-3 text-center text-xs opacity-50">{{ loading && !market ? '…' : 'No buyers' }}</div>
                        </div>
                        <div>
                            <div class="mk-colhead"><span>Sellers</span><span style="color: var(--g-red)">ask · qty</span></div>
                            <div v-if="market && market.asks.length" class="space-y-0.5">
                                <button v-for="lvl in market.asks" :key="lvl.price" class="mk-lvl is-ask" @click="fillFromLevel('sell', lvl)">
                                    <span>{{ fmtPrice(lvl.price) }}</span><span class="opacity-60">{{ formatNumber(lvl.quantity) }}</span>
                                </button>
                            </div>
                            <div v-else class="py-3 text-center text-xs opacity-50">{{ loading && !market ? '…' : 'No sellers' }}</div>
                        </div>
                    </div>
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
                        <label class="text-xs opacity-60">Price</label>
                        <input v-model.number="orderPrice" type="number" step="0.01" :min="market?.floor" :max="market?.ceiling" class="g-input w-28">
                        <label class="text-xs opacity-60">×</label>
                        <input v-model.number="orderQty" type="number" min="1" class="g-input w-24">
                        <div class="flex-1 text-right text-sm font-bold tabular-nums">= 🪙 {{ formatNumber(orderTotal) }}</div>
                        <button class="g-btn py-2" :class="orderSide === 'sell' ? 'g-btn-danger' : 'g-btn-primary'" :disabled="busy || !orderValid" @click="emit('place-order', resource.id, orderSide, orderPrice, Math.floor(orderQty))">
                            {{ orderSide === 'sell' ? 'List for sale' : 'Place buy offer' }}
                        </button>
                    </div>
                    <p class="mt-1 text-[11px] opacity-50">Offers must sit between floor and ceiling. Crossing offers fill instantly at the resting price.</p>
                </section>

                <!-- My orders -->
                <section v-if="market && market.myOrders.length" class="mk-sec">
                    <header>Your open offers</header>
                    <div class="space-y-1">
                        <div v-for="o in market.myOrders" :key="o.id" class="mk-order">
                            <span :style="{ color: o.side === 'sell' ? 'var(--g-red)' : 'var(--g-green)' }">{{ o.side === 'sell' ? 'Sell' : 'Buy' }}</span>
                            <span>{{ formatNumber(o.quantity - o.filled) }} @ {{ fmtPrice(o.price) }}</span>
                            <button class="g-icon g-icon-sm" :disabled="busy" @click="emit('cancel-order', o.id)">✕</button>
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
.mk-detail { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
.mk-title { display: flex; align-items: center; gap: 14px; }
.mk-prices { display: flex; gap: 14px; }
.mk-prices span { display: flex; flex-direction: column; align-items: flex-end; }
.mk-prices i { font-style: normal; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.5; }
.mk-prices b { font-size: 14px; font-variant-numeric: tabular-nums; }
.mk-sec { padding: 12px 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--g-line); }
.mk-sec > header { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; opacity: 0.85; }
.mk-sec > header .opacity-50 { text-transform: none; letter-spacing: 0; font-weight: 600; }
.mk-colhead { display: flex; justify-content: space-between; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; margin-bottom: 4px; }
.mk-lvl { display: flex; width: 100%; justify-content: space-between; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--g-text); background: transparent; border: none; cursor: pointer; }
.mk-lvl.is-bid { color: #9af0a8; }
.mk-lvl.is-ask { color: #ffb3b3; }
.mk-lvl:hover { background: rgba(255, 255, 255, 0.08); }
.mk-toggle { display: inline-flex; padding: 2px; border-radius: 8px; background: rgba(0, 0, 0, 0.25); }
.mk-toggle button { padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; color: var(--g-muted); background: transparent; border: none; cursor: pointer; text-transform: none; letter-spacing: 0; }
.mk-toggle button.is-sell { background: rgba(255, 107, 107, 0.25); color: #ffb3b3; }
.mk-toggle button.is-buy { background: rgba(79, 211, 106, 0.25); color: #9af0a8; }
.mk-order { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.06); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
:global(.town-root .g-input) { padding: 7px 10px; border-radius: 10px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--g-line); color: var(--g-text); font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; outline: none; }
:global(.town-root .g-input:focus) { border-color: rgba(255, 255, 255, 0.35); }
</style>
