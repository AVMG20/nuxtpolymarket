<script setup lang="ts">
import { RESOURCES, TIERS } from '#shared/utils/caravan/config'
import { projectRates } from '#shared/utils/caravan/sim'

/**
 * The storehouse.
 *
 * Stock used to live as a strip in the top bar, which meant it was tiny, it
 * wrapped, and on a laptop it was effectively unreadable. A panel gives every
 * resource a full row, room for its per-hour rate, and somewhere to put the
 * numbers that actually drive a decision -- like how long the larder lasts.
 */

const { state, world, bonuses } = useCaravan()

const STORAGE_KEY = 'caravan:storehouse-open'
const open = ref(true)

onMounted(() => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored !== null) open.value = stored === '1'
    } catch {
        // Blocked storage just means the panel starts open every time.
    }
})

function toggle() {
    open.value = !open.value
    try {
        localStorage.setItem(STORAGE_KEY, open.value ? '1' : '0')
    } catch {
        // Preference simply will not persist.
    }
}

/**
 * Production and consumption per hour, from the real simulation. Provisions come
 * back negative because workers eat them, which is exactly the number you want
 * when deciding whether to refine more bread.
 */
const rates = computed(() => (state.value ? projectRates(state.value, world.value) : null))

function rate(id: string): number {
    return rates.value?.resourcesPerHour[id] ?? 0
}

const groups = computed(() => {
    if (!state.value) return []
    return TIERS
        .filter(tier => tier.tier <= state.value!.tier)
        .reverse()
        .map(tier => ({
            tier,
            rows: [...tier.raw, ...tier.refined].map(id => ({
                id,
                name: RESOURCES[id]?.name ?? id,
                kind: RESOURCES[id]?.kind,
                amount: state.value!.resources[id] ?? 0,
                perHour: rate(id)
            }))
        }))
})

/**
 * How long the larder holds out at the current burn. This is the one number that
 * decides whether a caravan survives the night, so it gets its own tile.
 */
const rations = computed(() => {
    if (!state.value) return null
    let stock = 0
    let burn = 0
    for (const tier of TIERS) {
        stock += state.value.resources[tier.provision] ?? 0
        burn += Math.min(0, rate(tier.provision))
    }
    if (stock <= 0) return { stock, hours: 0 }
    if (burn >= 0) return { stock, hours: Infinity }
    return { stock, hours: stock / -burn }
})

function formatHours(hours: number): string {
    if (!Number.isFinite(hours)) return 'holding steady'
    if (hours >= 48) return `${Math.round(hours / 24)} days left`
    if (hours >= 2) return `${Math.round(hours)} hours left`
    return `${Math.max(1, Math.round(hours * 60))} min left`
}
</script>

<template>
    <aside
        class="relative z-20 flex shrink-0 flex-col border-l border-default/60 bg-elevated/30 backdrop-blur transition-[width] duration-200"
        :class="open ? 'w-64' : 'w-11'"
    >
        <button
            type="button"
            class="flex w-full items-center gap-2 border-b border-default/50 px-3 py-2.5 text-left transition hover:bg-elevated/60"
            :aria-label="open ? 'Collapse the storehouse' : 'Open the storehouse'"
            @click="toggle"
        >
            <UIcon name="i-lucide-warehouse" class="size-5 shrink-0 text-muted" />
            <span v-if="open" class="flex-1 text-sm font-semibold">Storehouse</span>
            <UIcon
                v-if="open"
                name="i-lucide-chevrons-right"
                class="size-4 shrink-0 text-muted"
            />
        </button>

        <!-- Collapsed rail: still worth a glance, so it keeps the two numbers
             that change fastest rather than becoming a blank strip. -->
        <div v-if="!open" class="flex flex-1 flex-col items-center gap-4 py-4">
            <UTooltip v-if="rates" :text="`${formatNumber(rates.harvestValuePerHour)} harvest value / hr`">
                <UIcon name="i-lucide-trending-up" class="size-4 text-primary" />
            </UTooltip>
            <UTooltip v-if="rations" :text="`${formatNumber(rations.stock)} rations · ${formatHours(rations.hours)}`">
                <UIcon
                    name="i-lucide-wheat"
                    class="size-4"
                    :class="rations.hours < 4 ? 'text-error' : rations.hours < 12 ? 'text-warning' : 'text-muted'"
                />
            </UTooltip>
            <div class="mt-2 [writing-mode:vertical-rl] text-[10px] uppercase tracking-widest text-muted">
                Storehouse
            </div>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-y-auto">
            <!-- Headline tiles -->
            <div class="space-y-1.5 border-b border-default/50 p-3">
                <!-- Coins and gems are already in the site sidebar; this panel
                     carries only what is specific to the caravan. -->
                <!-- Deliveries pay nothing, so the honest headline is what the
                     hour's haul is worth if you sold it as it comes out. -->
                <UTooltip v-if="rates" text="Coin value of everything harvested in an hour, sold as-is">
                    <div class="flex w-full items-center justify-between rounded-lg bg-primary/10 px-2.5 py-1.5">
                        <span class="flex items-center gap-1.5 text-xs text-muted">
                            <UIcon name="i-lucide-trending-up" class="size-3.5 text-primary" />
                            Harvest value
                        </span>
                        <span class="font-mono text-sm font-semibold text-success">{{ formatNumber(rates.harvestValuePerHour) }} / hr</span>
                    </div>
                </UTooltip>
                <div v-if="rates && rates.gemsPerHour > 0.001" class="flex items-center justify-between px-2.5 text-[11px]">
                    <span class="text-muted">Gem seams</span>
                    <span class="font-mono text-secondary">+{{ (rates.gemsPerHour * 24).toFixed(1) }} gems / day</span>
                </div>

                <div
                    v-if="rations"
                    class="mt-2 flex items-center justify-between rounded-lg px-2.5 py-1.5"
                    :class="rations.hours < 4 ? 'bg-error/10' : rations.hours < 12 ? 'bg-warning/10' : 'bg-default/40'"
                >
                    <span class="flex items-center gap-1.5 text-xs text-muted">
                        <UIcon name="i-lucide-wheat" class="size-3.5" />
                        Rations
                    </span>
                    <div class="text-right">
                        <div class="font-mono text-sm font-semibold">{{ formatNumber(rations.stock) }}</div>
                        <div
                            class="text-[10px]"
                            :class="rations.hours < 4 ? 'text-error' : rations.hours < 12 ? 'text-warning' : 'text-muted'"
                        >
                            {{ formatHours(rations.hours) }}
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-between rounded-lg bg-default/40 px-2.5 py-1.5">
                    <span class="flex items-center gap-1.5 text-xs text-muted">
                        <UIcon name="i-lucide-gem" class="size-3.5" />
                        Salvage shards
                    </span>
                    <span class="font-mono text-sm font-semibold">{{ formatNumber(state?.shards ?? 0) }}</span>
                </div>
            </div>

            <!-- Stock, newest tier first: that is the one you are working. -->
            <div v-for="group in groups" :key="group.tier.tier" class="border-b border-default/40 px-3 py-2.5">
                <div class="mb-1.5 flex items-center gap-1.5">
                    <span class="size-1.5 rounded-full" :style="{ backgroundColor: group.tier.color }" />
                    <span class="text-[11px] font-semibold uppercase tracking-wide" :style="{ color: group.tier.glow }">
                        T{{ group.tier.tier }}
                    </span>
                </div>
                <div class="space-y-0.5">
                    <div
                        v-for="row in group.rows"
                        :key="row.id"
                        class="flex items-center justify-between gap-2 rounded px-1 py-0.5"
                        :class="row.amount > 0 || row.perHour !== 0 ? '' : 'opacity-40'"
                    >
                        <CaravanResource :id="row.id" size="sm" />
                        <span class="flex shrink-0 items-baseline gap-1.5 text-xs">
                            <span
                                v-if="Math.abs(row.perHour) >= 0.5"
                                class="font-mono text-[10px]"
                                :class="row.perHour > 0 ? 'text-success/80' : 'text-error/80'"
                            >{{ row.perHour > 0 ? '+' : '' }}{{ formatNumber(row.perHour) }}</span>
                            <span class="font-mono font-semibold">{{ formatNumber(row.amount) }}</span>
                        </span>
                    </div>
                </div>
            </div>

            <p v-if="bonuses" class="px-3 py-3 text-[11px] leading-relaxed text-muted">
                Rates come from running the real simulation forward two hours, so they already account for travel,
                depletion and rations. Coins come from selling at the market, never from deliveries.
            </p>
        </div>
    </aside>
</template>
