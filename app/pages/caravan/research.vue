<script setup lang="ts">
import {
    MAX_CHARTERS, MAX_DEEDS, MAX_TIER, RESEARCH, RESEARCH_BY_ID, TIERS,
    charterGemCost, deedGemCost, researchSeconds
} from '#shared/utils/caravan/config'
import { researchAvailable } from '#shared/utils/caravan/progression'
import { tierProgress } from '#shared/utils/caravan/state'

/**
 * Tier advancement and research, on one screen because they are the same loop:
 * tiers unlock research, research raises the caps that make the next tier
 * reachable. This is where a session's coins and refined goods actually go.
 */

const { state, research, advanceTier, bonuses, buyCharter, buyDeed, serverNow, cancelResearch } = useCaravan()

// A one-second tick so the research countdown moves on its own.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { now.value = serverNow() }, 1000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

/** The project currently under way, if any. */
const active = computed(() => {
    const job = state.value?.researchJob
    if (!job) return null
    const def = RESEARCH_BY_ID[job.id]
    const span = Math.max(1, job.doneAt - job.startedAt)
    return {
        job,
        def,
        progress: Math.max(0, Math.min(1, (now.value - job.startedAt) / span)),
        remaining: Math.max(0, job.doneAt - now.value)
    }
})

function countdown(ms: number): string {
    const seconds = Math.ceil(ms / 1000)
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    return `${seconds}s`
}

/** How long a project would take at the current research speed. */
function projectLength(tier: number): string {
    const seconds = researchSeconds(tier) / (1 + (bonuses.value?.researchSpeed ?? 0) / 100)
    if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`
    return `${Math.round(seconds / 60)}m`
}
const { user } = useAuth()

const balance = computed(() => Number.parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)
const charters = computed(() => state.value?.charters ?? 0)
const deeds = computed(() => state.value?.deeds ?? 0)
const progress = computed(() => (state.value ? tierProgress(state.value) : null))
const done = computed(() => new Set(state.value?.research ?? []))

const canAdvance = computed(() => {
    if (!progress.value) return false
    return progress.value.resourcesMet
        && progress.value.nodesMet
        && balance.value >= progress.value.requirement.coins
})

/** Research grouped by the tier that unlocks it, so the path forward is visible. */
const groups = computed(() =>
    TIERS
        .filter(t => t.tier >= 2)
        .map(t => ({
            tier: t,
            entries: RESEARCH.filter(r => r.tier === t.tier).map((def) => {
                const gate = state.value ? researchAvailable(state.value, def.id) : { ok: false }
                const affordable = state.value
                    && balance.value >= def.coins
                    && Object.entries(def.resources).every(([id, count]) => (state.value!.resources[id] ?? 0) >= count)
                return { def, gate, affordable, owned: done.value.has(def.id) }
            })
        }))
        .filter(g => g.entries.length)
)
</script>

<template>
    <div class="absolute inset-0 overflow-y-auto p-5">
        <div class="mx-auto max-w-6xl space-y-6">
            <!-- Tier advancement -->
            <section
                v-if="progress"
                class="overflow-hidden rounded-2xl border"
                :style="{ borderColor: progress.nextTier?.glow + '55' }"
            >
                <div
                    class="px-5 py-4"
                    :style="{ background: `linear-gradient(120deg, ${progress.nextTier?.color}26, transparent 70%)` }"
                >
                    <div class="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <div class="text-xs uppercase tracking-wide text-muted">Next tier</div>
                            <h1 class="text-2xl font-bold" :style="{ color: progress.nextTier?.glow }">
                                {{ progress.nextTier?.name }}
                            </h1>
                            <p class="mt-1 max-w-lg text-sm text-muted">
                                Opens the next ring of the map, its resources and recipes, and the research board behind it.
                            </p>
                        </div>
                        <UButton
                            size="lg"
                            icon="i-lucide-chevrons-up"
                            label="Advance"
                            :disabled="!canAdvance"
                            @click="advanceTier()"
                        />
                    </div>
                </div>

                <div class="grid gap-px bg-default/40 sm:grid-cols-3">
                    <div class="bg-elevated/40 px-4 py-3">
                        <div class="text-xs uppercase tracking-wide text-muted">Coins</div>
                        <CoinBalance
                            :value="progress.requirement.coins"
                            :danger="balance < progress.requirement.coins"
                            class="text-lg"
                        />
                    </div>
                    <div class="bg-elevated/40 px-4 py-3">
                        <div class="text-xs uppercase tracking-wide text-muted">Nodes held</div>
                        <div class="font-mono text-lg" :class="progress.nodesMet ? 'text-success' : 'text-error'">
                            {{ progress.nodesOwned }} / {{ progress.requirement.nodes }}
                        </div>
                    </div>
                    <div class="space-y-0.5 bg-elevated/40 px-4 py-3">
                        <div class="text-xs uppercase tracking-wide text-muted">Materials</div>
                        <CaravanResource
                            v-for="entry in progress.resources"
                            :key="entry.id"
                            :id="entry.id"
                            :amount="entry.need"
                            :have="entry.have"
                            class="flex w-full justify-between"
                        />
                    </div>
                </div>
            </section>

            <section v-else class="rounded-2xl border border-primary/40 bg-primary/5 px-5 py-6 text-center">
                <h1 class="text-xl font-bold text-primary">Voidreach reached</h1>
                <p class="mt-1 text-sm text-muted">Tier {{ MAX_TIER }} is the end of the road. Everything left is optimisation.</p>
            </section>

            <!-- Caps -->
            <div class="grid gap-3 sm:grid-cols-4">
                <div class="rounded-xl border border-default/60 bg-elevated/30 px-4 py-3">
                    <div class="text-xs uppercase tracking-wide text-muted">Worker cap</div>
                    <div class="font-mono text-xl">{{ bonuses?.maxWorkers ?? 3 }}</div>
                </div>
                <div class="rounded-xl border border-default/60 bg-elevated/30 px-4 py-3">
                    <div class="text-xs uppercase tracking-wide text-muted">Capital cap</div>
                    <div class="font-mono text-xl">{{ bonuses?.maxCapitals ?? 1 }}</div>
                </div>
                <div class="rounded-xl border border-default/60 bg-elevated/30 px-4 py-3">
                    <div class="text-xs uppercase tracking-wide text-muted">Global speed</div>
                    <div class="font-mono text-xl text-success">+{{ bonuses?.speed ?? 0 }}%</div>
                </div>
                <div class="rounded-xl border border-default/60 bg-elevated/30 px-4 py-3">
                    <div class="text-xs uppercase tracking-wide text-muted">Global carry</div>
                    <div class="font-mono text-xl text-success">+{{ bonuses?.carry ?? 0 }}%</div>
                </div>
            </div>

            <!-- What is being researched right now. -->
            <section
                v-if="active"
                class="overflow-hidden rounded-xl border border-primary/50 bg-primary/5 px-4 py-3"
            >
                <div class="flex items-center gap-3">
                    <UIcon name="i-lucide-flask-conical" class="size-5 shrink-0 animate-pulse text-primary" />
                    <div class="min-w-0 flex-1">
                        <div class="flex items-baseline justify-between gap-2">
                            <span class="truncate text-sm font-medium">{{ active.def?.name ?? active.job.id }}</span>
                            <span class="font-mono text-xs text-muted">{{ countdown(active.remaining) }}</span>
                        </div>
                        <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-default/60">
                            <div
                                class="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
                                :style="{ width: `${active.progress * 100}%` }"
                            />
                        </div>
                    </div>
                    <UTooltip text="Refunds whatever share of the work is still outstanding">
                        <UButton
                            icon="i-lucide-x"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            aria-label="Abandon this project"
                            @click="cancelResearch()"
                        />
                    </UTooltip>
                </div>
            </section>

            <!-- Crown grants: the only gem purchases in the game, both permanent
                 slot upgrades that research would otherwise take tiers to reach. -->
            <section class="space-y-3">
                <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-secondary">
                    <UIcon name="i-lucide-gem" class="size-4" />
                    Crown grants
                    <span class="text-xs font-normal normal-case text-muted">bought with gems, never required</span>
                </h2>

                <div class="grid gap-3 md:grid-cols-2">
                    <div class="rounded-xl border border-secondary/40 bg-secondary/5 p-4">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <div class="font-semibold">Caravan Charter</div>
                                <p class="mt-0.5 text-sm text-muted">
                                    A permanent extra worker slot, stacking on top of every research cap.
                                </p>
                            </div>
                            <UBadge color="secondary" variant="subtle" :label="`${charters}/${MAX_CHARTERS}`" />
                        </div>
                        <UButton
                            class="mt-3"
                            block
                            color="secondary"
                            icon="i-lucide-gem"
                            :label="charters >= MAX_CHARTERS ? 'All charters claimed' : `${charterGemCost(charters)} gems`"
                            :disabled="charters >= MAX_CHARTERS || gems < charterGemCost(charters)"
                            @click="buyCharter()"
                        />
                    </div>

                    <div class="rounded-xl border border-secondary/40 bg-secondary/5 p-4">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <div class="font-semibold">Royal Deed</div>
                                <p class="mt-0.5 text-sm text-muted">
                                    A permanent extra capital. Workers haul to the nearest one, so a second seat halves the walk for a whole arm of the map.
                                </p>
                            </div>
                            <UBadge color="secondary" variant="subtle" :label="`${deeds}/${MAX_DEEDS}`" />
                        </div>
                        <UButton
                            class="mt-3"
                            block
                            color="secondary"
                            icon="i-lucide-gem"
                            :label="deeds >= MAX_DEEDS ? 'All deeds claimed' : `${deedGemCost(deeds)} gems`"
                            :disabled="deeds >= MAX_DEEDS || gems < deedGemCost(deeds)"
                            @click="buyDeed()"
                        />
                    </div>
                </div>
            </section>

            <!-- Research board -->
            <section v-for="group in groups" :key="group.tier.tier" class="space-y-3">
                <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide" :style="{ color: group.tier.glow }">
                    <span class="size-2 rounded-full" :style="{ backgroundColor: group.tier.color }" />
                    {{ group.tier.name }}
                    <span v-if="(state?.tier ?? 1) < group.tier.tier" class="text-xs font-normal normal-case text-muted">
                        locked until tier {{ group.tier.tier }}
                    </span>
                </h2>

                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div
                        v-for="entry in group.entries"
                        :key="entry.def.id"
                        class="flex flex-col rounded-xl border bg-elevated/30 p-4 transition"
                        :class="entry.owned ? 'border-primary/50' : 'border-default/60'"
                        :style="{ opacity: (state?.tier ?? 1) < group.tier.tier ? 0.45 : 1 }"
                    >
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <div class="font-semibold">{{ entry.def.name }}</div>
                                <p class="mt-0.5 text-sm text-muted">{{ entry.def.description }}</p>
                            </div>
                            <UIcon v-if="entry.owned" name="i-lucide-check-circle-2" class="size-5 shrink-0 text-primary" />
                        </div>

                        <div v-if="!entry.owned" class="mt-3 space-y-1 border-t border-default/40 pt-3 text-sm">
                            <div class="flex items-center justify-between">
                                <span class="text-muted">Coins</span>
                                <CoinBalance :value="entry.def.coins" :danger="balance < entry.def.coins" class="text-sm" />
                            </div>
                            <CaravanResource
                                v-for="(count, id) in entry.def.resources"
                                :key="id"
                                :id="id"
                                :amount="count"
                                :have="state?.resources[id] ?? 0"
                                class="flex w-full justify-between"
                            />
                            <div class="flex justify-between pt-0.5">
                                <span class="text-muted">Takes</span>
                                <span class="font-mono text-muted">{{ projectLength(entry.def.tier) }}</span>
                            </div>
                        </div>

                        <div class="mt-3 pt-0">
                            <UButton
                                v-if="!entry.owned"
                                block
                                size="sm"
                                :label="active ? 'Laboratory busy' : entry.gate.ok ? 'Research' : entry.gate.reason ?? 'Locked'"
                                :disabled="!entry.gate.ok || !entry.affordable || Boolean(active)"
                                @click="research(entry.def.id)"
                            />
                            <div v-else class="text-center text-xs font-medium text-primary">Researched</div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
