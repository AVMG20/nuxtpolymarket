<script setup lang="ts">
import {
    CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_NAMES, MARKET_REFRESH_GEMS,
    RARITY_BY_ID, RESOURCES, TIERS, salePrice
} from '#shared/utils/caravan/config'
import { derivedStats, workerQuality } from '#shared/utils/caravan/workers'
import type { Worker } from '#shared/utils/caravan/types'

/**
 * The recruitment market.
 *
 * A new slate every twelve hours, derived from the save seed rather than stored,
 * so it costs nothing to keep and cannot drift between client and server. The
 * draw is the point: most recruits are ordinary, one occasionally comes from the
 * tier above, and a well-rolled worker from a tier below can still be the best
 * one on the slate.
 */

const {
    state, bonuses, market, marketRefreshAtMs, serverNow,
    hireRecruit, refreshMarket, sellResources
} = useCaravan()

const tab = ref<'recruits' | 'sell'>('recruits')

/** Everything in the storehouse worth listing, newest tier first. */
const sellable = computed(() => {
    if (!state.value) return []
    return TIERS
        .filter(tier => tier.tier <= state.value!.tier)
        .reverse()
        .map(tier => ({
            tier,
            rows: [...tier.raw, ...tier.refined]
                .map(id => ({
                    id,
                    stock: state.value!.resources[id] ?? 0,
                    price: salePrice(id),
                    kind: RESOURCES[id]?.kind
                }))
                .filter(row => row.stock > 0)
        }))
        .filter(group => group.rows.length)
})

/**
 * What a recruit would be worth next to the roster you already have. Comparing
 * raw stats is misleading -- an existing worker has levels behind it -- so this
 * compares the recruit's ceiling against what your current crew have actually
 * grown into.
 */
function comparison(recruit: { worker: Worker }) {
    const crew = state.value?.workers ?? []
    if (!crew.length || !state.value || !bonuses.value) return null

    const ceiling = recruit.worker.base.carry * recruit.worker.growth
    const best = Math.max(...crew.map(w => derivedStats(w, state.value!.items, bonuses.value!).carry))
    const weakest = Math.min(...crew.map(w => derivedStats(w, state.value!.items, bonuses.value!).carry))

    return {
        ceiling: Math.round(ceiling),
        best: Math.round(best),
        // Positive means this recruit will eventually beat your weakest hand.
        beatsWeakest: ceiling > weakest,
        beatsBest: ceiling > best
    }
}

/** How much of each resource is staged for sale. */
const basket = ref<Record<string, number>>({})

const basketTotal = computed(() =>
    Object.entries(basket.value).reduce((sum, [id, amount]) => sum + amount * salePrice(id), 0)
)

const basketCount = computed(() =>
    Object.values(basket.value).filter(amount => amount > 0).length
)

function stage(id: string, amount: number) {
    const available = state.value?.resources[id] ?? 0
    const next = Math.max(0, Math.min(available, Math.floor(amount)))
    if (next <= 0) {
        const { [id]: _removed, ...rest } = basket.value
        basket.value = rest
    } else {
        basket.value = { ...basket.value, [id]: next }
    }
}

/** Stage everything raw. Provisions are never included -- workers eat those. */
function stageAllRaw() {
    const next: Record<string, number> = {}
    for (const group of sellable.value) {
        for (const row of group.rows) {
            if (row.kind === 'raw') next[row.id] = row.stock
        }
    }
    basket.value = next
}

async function confirmSale() {
    await sellResources(basket.value)
    basket.value = {}
}
const { user } = useAuth()

const balance = computed(() => Number.parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)
const atCap = computed(() => (state.value?.workers.length ?? 0) >= (bonuses.value?.maxWorkers ?? 3))

// A one-second tick, purely so the countdown moves.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { now.value = serverNow() }, 1000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const countdown = computed(() => {
    const remaining = Math.max(0, marketRefreshAtMs.value - now.value)
    const hours = Math.floor(remaining / 3_600_000)
    const minutes = Math.floor((remaining % 3_600_000) / 60_000)
    const seconds = Math.floor((remaining % 60_000) / 1000)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`
})
</script>

<template>
    <div class="absolute inset-0 overflow-y-auto p-5">
        <div class="mx-auto max-w-6xl space-y-5">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 class="text-xl font-semibold">Market</h1>
                    <p class="text-sm text-muted">
                        <template v-if="tab === 'recruits'">
                            A fresh slate in <span class="font-mono text-default">{{ countdown }}</span>.
                            {{ state?.workers.length ?? 0 }} of {{ bonuses?.maxWorkers ?? 3 }} worker slots filled.
                        </template>
                        <template v-else>
                            The only place coins come from. Raw goods fetch 60% of value, refined goods the full price.
                        </template>
                    </p>
                </div>

                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1 rounded-lg bg-elevated/50 p-0.5">
                        <UButton
                            size="xs"
                            color="neutral"
                            :variant="tab === 'recruits' ? 'soft' : 'ghost'"
                            icon="i-lucide-users-round"
                            label="Recruits"
                            @click="tab = 'recruits'"
                        />
                        <UButton
                            size="xs"
                            color="neutral"
                            :variant="tab === 'sell' ? 'soft' : 'ghost'"
                            icon="i-lucide-coins"
                            label="Sell goods"
                            @click="tab = 'sell'"
                        />
                    </div>
                    <UTooltip v-if="tab === 'recruits'" text="Tear up this slate and post a new one now">
                        <UButton
                            color="secondary"
                            variant="soft"
                            icon="i-lucide-refresh-cw"
                            :label="`New slate · ${MARKET_REFRESH_GEMS} gems`"
                            :disabled="gems < MARKET_REFRESH_GEMS"
                            @click="refreshMarket()"
                        />
                    </UTooltip>
                </div>
            </div>

            <!-- Selling -->
            <template v-if="tab === 'sell'">
                <div v-if="!sellable.length" class="rounded-xl border border-dashed border-default/60 p-10 text-center text-muted">
                    The storehouse is empty. Send workers out first.
                </div>

                <template v-else>
                    <div class="flex flex-wrap items-center gap-2">
                        <UButton size="xs" color="neutral" variant="ghost" label="Stage all raw goods" @click="stageAllRaw" />
                        <UButton size="xs" color="neutral" variant="ghost" label="Clear" :disabled="!basketCount" @click="basket = {}" />
                    </div>

                    <div v-for="group in sellable" :key="group.tier.tier" class="space-y-2">
                        <div class="flex items-center gap-1.5">
                            <span class="size-1.5 rounded-full" :style="{ backgroundColor: group.tier.color }" />
                            <span class="text-xs font-semibold uppercase tracking-wide" :style="{ color: group.tier.glow }">
                                T{{ group.tier.tier }}
                            </span>
                        </div>
                        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            <div
                                v-for="row in group.rows"
                                :key="row.id"
                                class="rounded-xl border bg-elevated/30 px-3 py-2.5 transition"
                                :class="basket[row.id] ? 'border-primary/50' : 'border-default/60'"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <CaravanResource :id="row.id" />
                                    <span class="flex shrink-0 items-center gap-1 text-xs text-muted">
                                        <CoinBalance :value="row.price" />
                                        <span>ea</span>
                                    </span>
                                </div>
                                <div class="mt-1 flex items-baseline justify-between text-[11px]">
                                    <span class="text-muted">In store</span>
                                    <span class="font-mono">{{ formatNumber(row.stock) }}</span>
                                </div>
                                <div class="mt-2 flex items-center gap-1">
                                    <UButton size="xs" color="neutral" variant="soft" label="¼" @click="stage(row.id, row.stock / 4)" />
                                    <UButton size="xs" color="neutral" variant="soft" label="½" @click="stage(row.id, row.stock / 2)" />
                                    <UButton size="xs" color="neutral" variant="soft" label="All" @click="stage(row.id, row.stock)" />
                                    <span
                                        v-if="basket[row.id]"
                                        class="ml-auto font-mono text-[11px] text-primary"
                                    >{{ formatNumber(basket[row.id]!) }} staged</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-elevated/95 px-4 py-3 backdrop-blur">
                        <div>
                            <div class="text-xs text-muted">{{ basketCount }} lines staged</div>
                            <CoinBalance :value="basketTotal" class="text-lg font-semibold" />
                        </div>
                        <UButton
                            icon="i-lucide-coins"
                            label="Sell"
                            size="lg"
                            :disabled="!basketCount"
                            @click="confirmSale"
                        />
                    </div>
                </template>
            </template>

            <template v-else>

            <UAlert
                v-if="atCap"
                color="warning"
                variant="subtle"
                icon="i-lucide-users"
                title="Worker limit reached"
                description="Research a larger crew, or buy a Caravan Charter, before taking anyone else on."
            />

            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div
                    v-for="recruit in market"
                    :key="recruit.slot"
                    class="relative overflow-hidden rounded-xl border bg-elevated/30 transition"
                    :class="recruit.purchased ? 'border-default/40 opacity-50' : 'border-default/60'"
                    :style="recruit.overTier && !recruit.purchased
                        ? { borderColor: TIERS[recruit.worker.tier - 1]?.glow + '99' }
                        : {}"
                >
                    <div
                        class="px-4 py-3"
                        :style="{ background: `linear-gradient(120deg, ${TIERS[recruit.worker.tier - 1]?.color}26, transparent 70%)` }"
                    >
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <div class="truncate font-semibold">{{ recruit.worker.name }}</div>
                                <div class="flex items-center gap-2 text-[11px] uppercase tracking-wide">
                                    <span :style="{ color: RARITY_BY_ID[recruit.worker.rarity].color }">
                                        {{ RARITY_BY_ID[recruit.worker.rarity].name }}
                                    </span>
                                    <span class="text-muted">
                                        T{{ recruit.worker.tier }} {{ TIERS[recruit.worker.tier - 1]?.name }}
                                    </span>
                                </div>
                            </div>
                            <UBadge
                                v-if="recruit.overTier"
                                size="sm"
                                variant="subtle"
                                color="warning"
                                label="Above your tier"
                            />
                        </div>
                    </div>

                    <div class="space-y-3 px-4 py-3">
                        <!-- Trades -->
                        <div class="flex flex-wrap gap-1.5">
                            <span
                                v-for="category in recruit.worker.specialties"
                                :key="category"
                                class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
                                :style="{ color: CATEGORY_COLORS[category], backgroundColor: CATEGORY_COLORS[category] + '1f' }"
                            >
                                <UIcon :name="CATEGORY_ICONS[category]" class="size-3" />
                                {{ CATEGORY_NAMES[category] }}
                            </span>
                        </div>

                        <!-- Roll quality: the number that decides whether a lower
                             tier recruit is still worth taking. -->
                        <div>
                            <div class="mb-1 flex items-baseline justify-between text-[11px]">
                                <span class="text-muted">Starting roll</span>
                                <span class="font-mono">{{ Math.round(workerQuality(recruit.worker) * 100) }}%</span>
                            </div>
                            <div class="h-1.5 overflow-hidden rounded-full bg-default/60">
                                <div
                                    class="h-full rounded-full"
                                    :class="workerQuality(recruit.worker) > 0.66 ? 'bg-success' : workerQuality(recruit.worker) > 0.33 ? 'bg-warning' : 'bg-error'"
                                    :style="{ width: `${Math.max(4, workerQuality(recruit.worker) * 100)}%` }"
                                />
                            </div>
                        </div>

                        <div class="grid grid-cols-3 gap-1.5 text-center">
                            <div class="rounded-lg bg-default/40 py-1.5">
                                <div class="font-mono text-xs font-semibold">{{ recruit.worker.base.carry }}</div>
                                <div class="text-[9px] uppercase tracking-wide text-muted">Carry</div>
                            </div>
                            <div class="rounded-lg bg-default/40 py-1.5">
                                <div class="font-mono text-xs font-semibold">{{ recruit.worker.base.speed.toFixed(2) }}</div>
                                <div class="text-[9px] uppercase tracking-wide text-muted">Speed</div>
                            </div>
                            <div class="rounded-lg bg-default/40 py-1.5">
                                <div class="font-mono text-xs font-semibold">{{ recruit.worker.base.strength.toFixed(2) }}</div>
                                <div class="text-[9px] uppercase tracking-wide text-muted">Strength</div>
                            </div>
                        </div>

                        <!-- Rarity is a ceiling, not a head start. -->
                        <div class="flex items-center justify-between text-[11px]">
                            <span class="text-muted">Grows to</span>
                            <span class="font-mono" :style="{ color: RARITY_BY_ID[recruit.worker.rarity].color }">
                                ×{{ recruit.worker.growth.toFixed(1) }} by max level
                            </span>
                        </div>

                        <div v-if="comparison(recruit)" class="flex items-center gap-1.5 text-[11px]">
                            <UIcon
                                :name="comparison(recruit)!.beatsBest
                                    ? 'i-lucide-trending-up'
                                    : comparison(recruit)!.beatsWeakest ? 'i-lucide-minus' : 'i-lucide-trending-down'"
                                class="size-3"
                                :class="comparison(recruit)!.beatsBest
                                    ? 'text-success'
                                    : comparison(recruit)!.beatsWeakest ? 'text-warning' : 'text-muted'"
                            />
                            <span class="text-muted">
                                <template v-if="comparison(recruit)!.beatsBest">
                                    Ends up ahead of your best ({{ comparison(recruit)!.best }} carry)
                                </template>
                                <template v-else-if="comparison(recruit)!.beatsWeakest">
                                    Ends up mid-roster
                                </template>
                                <template v-else>
                                    Worse than everyone you have
                                </template>
                            </span>
                        </div>

                        <UButton
                            block
                            :icon="recruit.purchased ? 'i-lucide-check' : 'i-lucide-handshake'"
                            :label="recruit.purchased ? 'Hired' : `Hire for ${formatNumber(recruit.price)}`"
                            :disabled="recruit.purchased || atCap || balance < recruit.price"
                            @click="hireRecruit(recruit.slot)"
                        />
                    </div>
                </div>
            </div>

                <p class="text-xs text-muted">
                    Every tier is worth a flat 25% on a worker's starting stats and the roll on top spans 1.00x to 1.25x,
                    so a well-rolled recruit starts ahead of a badly-rolled one a tier above. Rarity decides how far they
                    grow from there, which is what makes a Legendary worth waiting for.
                </p>
            </template>
        </div>
    </div>
</template>
