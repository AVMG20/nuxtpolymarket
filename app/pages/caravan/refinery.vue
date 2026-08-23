<script setup lang="ts">
import {
    BASE_REFINERY_LINES, MAX_REFINERY_LINES, RECIPES, RESOURCES, TIERS,
    effectiveRefineSeconds, resourceColor, resourceIcon
} from '#shared/utils/caravan/config'
import { maxBatches } from '#shared/utils/caravan/state'

/**
 * The refinery.
 *
 * Refining is a queue: a batch occupies a line for real time, materials are
 * taken when it is queued, and goods land when the clock runs out. That makes
 * the refinery a second idle loop rather than a button, and makes "which recipe
 * gets the line" a decision worth making.
 */

const { state, refine, bonuses, setPolicy, serverNow, cancelRefine } = useCaravan()

const kitchenOn = computed(() => state.value?.policies?.autoRefine === true)
const tab = ref(String(state.value?.tier ?? 1))
watch(() => state.value?.tier, tier => { if (tier) tab.value = String(tier) })

const tiers = computed(() => TIERS.filter(t => t.tier <= (state.value?.tier ?? 1)))
const recipesForTab = computed(() => RECIPES.filter(r => r.tier === Number(tab.value)))

const lines = computed(() => BASE_REFINERY_LINES + (bonuses.value?.refineryLines ?? 0))
const queued = computed(() => state.value?.refineJobs?.length ?? 0)
/** Batches actually on a line right now, as opposed to waiting behind one. */
const running = computed(() =>
    (state.value?.refineJobs ?? []).filter(job => job.startedAt <= now.value).length
)

// A one-second tick so the progress bars move without re-fetching anything.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { now.value = serverNow() }, 1000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const jobs = computed(() => (state.value?.refineJobs ?? [])
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((job) => {
        const recipe = RECIPES.find(r => r.id === job.recipeId)
        const span = Math.max(1, job.doneAt - job.startedAt)
        const waiting = job.startedAt > now.value
        return {
            job,
            recipe,
            waiting,
            progress: waiting ? 0 : Math.max(0, Math.min(1, (now.value - job.startedAt) / span)),
            // A waiting batch counts down to when it starts, a running one to
            // when it lands -- those are the two questions you actually have.
            remaining: Math.max(0, (waiting ? job.startedAt : job.doneAt) - now.value)
        }
    }))

function stock(id: string) {
    return state.value?.resources[id] ?? 0
}

function batchesFor(recipeId: string) {
    return state.value ? maxBatches(state.value, recipeId) : 0
}

/** How long a run of this size would tie up a line. */
function duration(tier: number, batches: number): string {
    const seconds = effectiveRefineSeconds(tier, bonuses.value?.refineSpeed ?? 0) * batches
    if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`
    if (seconds >= 60) return `${Math.round(seconds / 60)}m`
    return `${Math.round(seconds)}s`
}

function countdown(ms: number): string {
    const seconds = Math.ceil(ms / 1000)
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    return `${seconds}s`
}
</script>

<template>
    <div class="absolute inset-0 overflow-y-auto p-5">
        <div class="mx-auto max-w-5xl space-y-5">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 class="text-xl font-semibold">Refinery</h1>
                    <p class="text-sm text-muted">
                        Raw goods go in, refined goods come out — after they have spent time on a line.
                        Queue as much as you like; lines decide how fast the backlog clears.
                    </p>
                </div>
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-1.5">
                        <span
                            v-for="line in lines"
                            :key="line"
                            class="size-2.5 rounded-full"
                            :class="line <= running ? 'bg-primary' : 'bg-default/60'"
                        />
                        <span class="ml-1 text-xs text-muted">
                            {{ running }}/{{ lines }} lines
                            <span v-if="lines < MAX_REFINERY_LINES">· research adds more</span>
                        </span>
                    </div>
                    <UButton
                        v-if="jobs.length"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-trash-2"
                        label="Clear queue"
                        @click="cancelRefine(null, true)"
                    />
                </div>
            </div>

            <!-- Running batches -->
            <div v-if="jobs.length" class="space-y-2">
                <div
                    v-for="entry in jobs"
                    :key="entry.job.id"
                    class="overflow-hidden rounded-xl border"
                    :class="entry.waiting ? 'border-default/60 bg-elevated/30' : 'border-primary/40 bg-primary/5'"
                >
                    <div class="flex items-center gap-3 px-4 py-3">
                        <span
                            class="grid size-9 shrink-0 place-items-center rounded-lg"
                            :style="{ backgroundColor: resourceColor(entry.recipe?.output ?? '') + '24' }"
                        >
                            <UIcon
                                :name="resourceIcon(entry.recipe?.output ?? '')"
                                class="size-5"
                                :style="{ color: resourceColor(entry.recipe?.output ?? '') }"
                            />
                        </span>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-baseline justify-between gap-2">
                                <span class="truncate text-sm font-medium">
                                    {{ formatNumber((entry.recipe?.outputCount ?? 1) * entry.job.batches) }}
                                    {{ RESOURCES[entry.recipe?.output ?? '']?.name }}
                                </span>
                                <span class="font-mono text-xs" :class="entry.waiting ? 'text-muted' : 'text-default'">
                                    {{ entry.waiting ? `starts in ${countdown(entry.remaining)}` : countdown(entry.remaining) }}
                                </span>
                            </div>
                            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-default/60">
                                <div
                                    class="h-full rounded-full transition-[width] duration-1000 ease-linear"
                                    :class="entry.waiting ? 'bg-muted/40' : 'bg-primary'"
                                    :style="{ width: `${entry.progress * 100}%` }"
                                />
                            </div>
                        </div>
                        <UButton
                            icon="i-lucide-x"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            aria-label="Cancel this batch"
                            @click="cancelRefine(entry.job.id)"
                        />
                    </div>
                </div>
            </div>
            <div v-else class="rounded-xl border border-dashed border-default/60 px-4 py-6 text-center text-sm text-muted">
                Every line is idle. Queue something below.
            </div>

            <!-- Kitchen standing order -->
            <div
                class="flex flex-wrap items-center gap-4 rounded-xl border px-4 py-3"
                :class="kitchenOn ? 'border-primary/50 bg-primary/5' : 'border-default/60 bg-elevated/30'"
            >
                <UIcon
                    name="i-lucide-cooking-pot"
                    class="size-5 shrink-0"
                    :class="kitchenOn ? 'text-primary' : 'text-muted'"
                />
                <div class="min-w-56 flex-1">
                    <div class="text-sm font-medium">Kitchen standing order</div>
                    <p class="text-xs text-muted">
                        <template v-if="bonuses?.canAutoRefine">
                            Bakes provisions the moment the larder runs dry, without occupying a line.
                        </template>
                        <template v-else>
                            Research <span class="text-default">Kitchen Standing Orders</span> at tier 3 to stop refining bread by hand.
                        </template>
                    </p>
                </div>
                <USwitch
                    :model-value="kitchenOn"
                    :disabled="!bonuses?.canAutoRefine"
                    @update:model-value="(v: boolean) => setPolicy({ autoRefine: v })"
                />
            </div>

            <!-- Tier picker -->
            <div class="flex flex-wrap gap-1.5">
                <UButton
                    v-for="t in tiers"
                    :key="t.tier"
                    size="sm"
                    color="neutral"
                    :variant="tab === String(t.tier) ? 'soft' : 'ghost'"
                    :style="tab === String(t.tier) ? { color: t.glow } : {}"
                    :label="`T${t.tier}`"
                    @click="tab = String(t.tier)"
                />
            </div>

            <!-- Recipes -->
            <div class="grid gap-3 md:grid-cols-2">
                <div
                    v-for="recipe in recipesForTab"
                    :key="recipe.id"
                    class="overflow-hidden rounded-xl border border-default/60 bg-elevated/30"
                >
                    <div class="flex items-center gap-3 border-b border-default/50 px-4 py-3">
                        <span
                            class="grid size-10 shrink-0 place-items-center rounded-lg"
                            :style="{ backgroundColor: resourceColor(recipe.output) + '24' }"
                        >
                            <UIcon
                                :name="resourceIcon(recipe.output)"
                                class="size-5"
                                :style="{ color: resourceColor(recipe.output) }"
                            />
                        </span>
                        <div class="min-w-0 flex-1">
                            <div class="font-semibold">{{ RESOURCES[recipe.output]?.name }}</div>
                            <div class="text-xs text-muted">
                                yields {{ recipe.outputCount }} · {{ duration(recipe.tier, 1) }} a batch
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="font-mono text-lg font-semibold">{{ formatNumber(stock(recipe.output)) }}</div>
                            <div class="text-[10px] uppercase tracking-wide text-muted">Stock</div>
                        </div>
                    </div>

                    <div class="space-y-2 px-4 py-3">
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                            <CaravanResource
                                v-for="(count, id) in recipe.inputs"
                                :key="id"
                                :id="id"
                                :amount="count"
                                :have="stock(id)"
                                :show-name="false"
                            />
                        </div>

                        <div class="flex gap-1.5">
                            <UButton
                                v-for="n in [1, 10]"
                                :key="n"
                                size="sm"
                                class="flex-1"
                                :variant="n === 1 ? 'solid' : 'soft'"
                                :label="`×${n}`"
                                :disabled="batchesFor(recipe.id) < n"
                                @click="refine(recipe.id, n)"
                            />
                            <UButton
                                size="sm"
                                class="flex-1"
                                variant="soft"
                                :label="`Max ×${formatNumber(Math.min(500, batchesFor(recipe.id)))}`"
                                :disabled="batchesFor(recipe.id) < 1"
                                @click="refine(recipe.id, Math.min(500, batchesFor(recipe.id)))"
                            />
                        </div>
                        <p v-if="queued >= lines" class="text-[11px] text-muted">
                            Every line is busy — anything queued now starts when one frees up.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
