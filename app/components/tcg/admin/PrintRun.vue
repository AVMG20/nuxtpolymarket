<script setup lang="ts">
import type { PrintRunPreview, TcgSetDetailPayload } from '#shared/types/tcg'

const props = defineProps<{ detail: TcgSetDetailPayload }>()
const emit = defineEmits<{ refresh: [] }>()

const { call } = useTcgAdmin()

const committed = computed(() => props.detail.set.status === 'committed')
const setId = computed(() => props.detail.set.id)

// ── Draft controls: N and god 1-in, saved on change (debounced) ──────────────

const targetPackCount = ref<number | null>(props.detail.set.targetPackCount)
const godPackOneIn = ref<number | null>(props.detail.set.godPackOneIn)
const saving = ref(false)

// Only sync inputs from props when they are not dirty (still equal to the last
// value we synced from the server) — a background refetch must never clobber
// what the admin is typing.
const lastSynced = {
    targetPackCount: props.detail.set.targetPackCount,
    godPackOneIn: props.detail.set.godPackOneIn
}

watch(() => props.detail.set, (set) => {
    if (targetPackCount.value === lastSynced.targetPackCount) targetPackCount.value = set.targetPackCount
    if (godPackOneIn.value === lastSynced.godPackOneIn) godPackOneIn.value = set.godPackOneIn
    lastSynced.targetPackCount = set.targetPackCount
    lastSynced.godPackOneIn = set.godPackOneIn
})

let saveTimer: ReturnType<typeof setTimeout> | null = null
function queueSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveDraft, 600)
}

async function saveDraft() {
    if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
    }
    if (committed.value) return
    const dirty = targetPackCount.value !== props.detail.set.targetPackCount
        || godPackOneIn.value !== props.detail.set.godPackOneIn
    if (!dirty) return
    saving.value = true
    try {
        await call('/api/tcg/admin/sets/update', {
            setId: setId.value,
            targetPackCount: targetPackCount.value,
            godPackOneIn: godPackOneIn.value
        }, '')
        emit('refresh')
    } finally {
        saving.value = false
    }
}

function clearGodRate() {
    godPackOneIn.value = null
    saveDraft()
}

// ── Preview from the server (authoritative math) ─────────────────────────────

const { data: preview, pending: previewPending, refresh: refreshPreview } = useAsyncData(
    `tcg-print-run-preview-${props.detail.set.id}`,
    () => apiFetch<PrintRunPreview>('/api/tcg/admin/print-run/preview', { query: { setId: props.detail.set.id } })
)

watch(() => props.detail, () => {
    refreshPreview()
})

const sheetById = computed(() => new Map(props.detail.sheets.map(sheet => [sheet.id, sheet])))

const sheetRows = computed(() => (preview.value?.sheets ?? []).map((row) => {
    const sheet = sheetById.value.get(row.sheetId)
    return {
        ...row,
        name: sheet?.name ?? row.sheetId,
        role: sheet?.role ?? '—',
        slots: sheet?.layout.length ?? 0,
        packSlots: sheet?.packSlots ?? 0
    }
}))

const populationSearch = ref('')
const populationRows = computed(() => {
    const rows = preview.value?.population ?? []
    const q = populationSearch.value.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(row => row.cardName.toLowerCase().includes(q)
        || row.cardNumber.toLowerCase().includes(q)
        || row.rarity.toLowerCase().includes(q))
})

const runN = computed(() => props.detail.set.targetPackCount ?? 0)

// Populations are packsServed·k·m/M and can be fractional (a pool-1 chase
// printing at small N may expect under one copy) — show at most 2 decimals.
function formatPopulation(population: number): string {
    if (Number.isInteger(population)) return String(population)
    return population.toFixed(2)
}

function oneInPacks(population: number): string {
    if (!runN.value || population <= 0) return '—'
    const x = runN.value / population
    return x >= 100 ? `1 in ${Math.round(x)}` : `1 in ${x.toFixed(1).replace(/\.0$/, '')}`
}

function finishLabel(finish: string, pattern: string | null): string {
    return pattern ? `${finish} · ${pattern}` : finish
}

// ── Published vs authored rate diagnostics (template-created sets) ───────────

const rateDiagnostics = computed(() => preview.value?.rateDiagnostics ?? [])
const godPreview = computed(() => preview.value?.godPreview ?? null)

/** '1 in X' when rarer than one per pack, else 'N/pack'. */
function perPackLabel(perPack: number): string {
    if (perPack <= 0) return '—'
    if (perPack < 1) {
        const oneIn = 1 / perPack
        return `1 in ${oneIn >= 100 ? Math.round(oneIn) : oneIn.toFixed(1).replace(/\.0$/, '')}`
    }
    return `${perPack.toFixed(2).replace(/\.?0+$/, '')}/pack`
}

function deltaClass(deltaPct: number): string {
    const abs = Math.abs(deltaPct)
    if (abs <= 5) return 'text-success'
    if (abs <= 15) return 'text-warning'
    return 'text-error'
}

function deltaLabel(deltaPct: number): string {
    return `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
}

// ── Commit ───────────────────────────────────────────────────────────────────

const confirmOpen = ref(false)
const committing = ref(false)
const freshDigest = ref<string | null>(null)

const canCommit = computed(() => !committed.value
    && !previewPending.value
    && (preview.value?.errors.length ?? 0) === 0
    && runN.value > 0)

async function commitRun() {
    committing.value = true
    try {
        const res = await call('/api/tcg/admin/commit', { setId: setId.value }, 'Print run committed') as { commitmentDigest: string, godPackCount: number }
        freshDigest.value = res.commitmentDigest
        confirmOpen.value = false
        emit('refresh')
    } catch {
        // toasted by call()
    } finally {
        committing.value = false
    }
}

const digest = computed(() => props.detail.set.commitmentDigest ?? freshDigest.value)
const godCount = computed(() => committed.value
    ? props.detail.set.godPackCount ?? 0
    : preview.value?.godPackCount ?? 0)
</script>

<template>
    <div class="space-y-6">
        <!-- Run parameters -->
        <section>
            <h3 class="mb-2 text-xs font-semibold tracking-widest text-muted uppercase">Run parameters</h3>
            <div v-if="!committed" class="flex flex-wrap items-end gap-6">
                <UFormField label="Target pack count (N)" description="Packs this run will sell before selling out">
                    <UInputNumber
                        v-model="targetPackCount"
                        :min="1"
                        :step="1"
                        placeholder="e.g. 300"
                        class="w-44"
                        @blur="saveDraft"
                        @update:model-value="queueSave"
                    />
                </UFormField>
                <UFormField
                    label="God pack rate (1 in …)"
                    description="Leave empty to disable god packs"
                    :help="godPreview?.feasible ? `G = ${godPreview.G} god pack${godPreview.G === 1 ? '' : 's'}` : undefined"
                >
                    <div class="flex items-center gap-1">
                        <UInputNumber
                            v-model="godPackOneIn"
                            :min="1"
                            :step="1"
                            placeholder="off"
                            class="w-36"
                            @blur="saveDraft"
                            @update:model-value="queueSave"
                        />
                        <UButton
                            v-if="godPackOneIn !== null"
                            icon="i-lucide-x"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            aria-label="Disable god packs"
                            @click="clearGodRate"
                        />
                    </div>
                </UFormField>
                <UAlert
                    v-if="godPreview && !godPreview.feasible"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-octagon-alert"
                    title="God pack rate infeasible"
                    :description="godPreview.reason ?? 'The requested god pack rate cannot be satisfied.'"
                    class="max-w-md"
                />
                <div class="pb-1 text-xs text-muted tabular-nums">
                    <span v-if="saving">Saving…</span>
                    <span v-else-if="preview">Derived god packs G = {{ godCount }}</span>
                </div>
            </div>
            <div v-else class="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-default bg-elevated px-4 py-3">
                <div>
                    <div class="text-[11px] tracking-wider text-muted uppercase">Target packs</div>
                    <div class="font-mono text-sm tabular-nums">{{ detail.set.targetPackCount }}</div>
                </div>
                <div>
                    <div class="text-[11px] tracking-wider text-muted uppercase">God packs</div>
                    <div class="font-mono text-sm tabular-nums">{{ godCount }}</div>
                </div>
                <div>
                    <div class="text-[11px] tracking-wider text-muted uppercase">God rate</div>
                    <div class="font-mono text-sm tabular-nums">{{ detail.set.godPackOneIn ? `1 in ${detail.set.godPackOneIn}` : 'off' }}</div>
                </div>
            </div>
        </section>

        <!-- Validation -->
        <section v-if="preview && (preview.errors.length || preview.warnings.length)" class="space-y-2">
            <UAlert
                v-for="(message, i) in preview.errors"
                :key="`error-${i}`"
                color="error"
                variant="subtle"
                icon="i-lucide-octagon-alert"
                :description="message"
            />
            <UAlert
                v-for="(message, i) in preview.warnings"
                :key="`warning-${i}`"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :description="message"
            />
        </section>

        <!-- Published vs authored rates (template-created sets) -->
        <section v-if="rateDiagnostics.length > 0">
            <h3 class="mb-2 text-xs font-semibold tracking-widest text-muted uppercase">Published vs authored</h3>
            <div class="overflow-x-auto rounded-lg border border-default">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-default bg-elevated text-left text-[11px] tracking-wider text-muted uppercase">
                            <th class="px-3 py-2 font-medium">Tier</th>
                            <th class="px-3 py-2 text-right font-medium">Published</th>
                            <th class="px-3 py-2 text-right font-medium">Authored</th>
                            <th class="px-3 py-2 text-right font-medium">Delta</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in rateDiagnostics" :key="row.label" class="border-b border-default last:border-b-0">
                            <td class="px-3 py-2 font-medium">{{ row.label }}</td>
                            <td class="px-3 py-2 text-right font-mono text-xs tabular-nums">{{ perPackLabel(row.publishedPerPack) }}</td>
                            <td class="px-3 py-2 text-right font-mono text-xs tabular-nums">{{ perPackLabel(row.authoredPerPack) }}</td>
                            <td class="px-3 py-2 text-right font-mono text-xs tabular-nums" :class="deltaClass(row.deltaPct)">
                                {{ deltaLabel(row.deltaPct) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="mt-1.5 text-xs text-muted">
                Deltas are informational — sheet geometry rounds the published rates; they never block a commit.
            </p>
        </section>

        <!-- Per-sheet impressions -->
        <section>
            <h3 class="mb-2 text-xs font-semibold tracking-widest text-muted uppercase">Sheet impressions</h3>
            <div v-if="previewPending && !preview" class="space-y-2">
                <USkeleton class="h-8 w-full" />
                <USkeleton class="h-8 w-full" />
            </div>
            <p v-else-if="sheetRows.length === 0" class="text-sm text-muted">
                No sheet serves any packs yet — author sheets and a pack template first.
            </p>
            <div v-else class="overflow-x-auto rounded-lg border border-default">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-default bg-elevated text-left text-[11px] tracking-wider text-muted uppercase">
                            <th class="px-3 py-2 font-medium">Sheet</th>
                            <th class="px-3 py-2 font-medium">Role</th>
                            <th class="px-3 py-2 text-right font-medium">M</th>
                            <th class="px-3 py-2 text-right font-medium">k</th>
                            <th class="px-3 py-2 text-right font-medium">Impressions R</th>
                            <th class="px-3 py-2 text-right font-medium">Cuts capacity</th>
                            <th class="px-3 py-2 text-right font-medium">Leftover tokens destroyed</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in sheetRows" :key="row.sheetId" class="border-b border-default last:border-b-0">
                            <td class="px-3 py-2 font-medium">{{ row.name }}</td>
                            <td class="px-3 py-2">
                                <UBadge :color="row.role === 'god' ? 'warning' : 'neutral'" variant="subtle" size="sm">
                                    {{ row.role }}
                                </UBadge>
                            </td>
                            <td class="px-3 py-2 text-right font-mono tabular-nums">{{ row.slots }}</td>
                            <td class="px-3 py-2 text-right font-mono tabular-nums">{{ row.packSlots }}</td>
                            <td class="px-3 py-2 text-right font-mono tabular-nums">{{ row.impressions }}</td>
                            <td class="px-3 py-2 text-right font-mono tabular-nums">{{ row.cutsCapacity }}</td>
                            <td class="px-3 py-2 text-right font-mono tabular-nums">{{ row.leftoverTokens }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Population -->
        <section>
            <div class="mb-2 flex items-center justify-between gap-4">
                <h3 class="text-xs font-semibold tracking-widest text-muted uppercase">
                    Projected population
                    <span v-if="preview?.exactWithinOne" class="ml-1 font-normal normal-case tracking-normal">(exact ±1)</span>
                </h3>
                <UInput
                    v-model="populationSearch"
                    icon="i-lucide-search"
                    size="sm"
                    placeholder="Filter cards…"
                    class="w-56"
                />
            </div>
            <p v-if="!preview || preview.population.length === 0" class="text-sm text-muted">
                Population appears once sheets are laid out and N is set.
            </p>
            <div v-else class="max-h-[28rem] overflow-auto rounded-lg border border-default">
                <table class="w-full text-sm">
                    <thead class="sticky top-0">
                        <tr class="border-b border-default bg-elevated text-left text-[11px] tracking-wider text-muted uppercase">
                            <th class="px-3 py-2 font-medium">No.</th>
                            <th class="px-3 py-2 font-medium">Card</th>
                            <th class="px-3 py-2 font-medium">Finish</th>
                            <th class="px-3 py-2 font-medium">Rarity</th>
                            <th class="px-3 py-2 text-right font-medium">Population</th>
                            <th class="px-3 py-2 text-right font-medium">Pull rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in populationRows" :key="row.printingId" class="border-b border-default last:border-b-0">
                            <td class="px-3 py-1.5 font-mono text-xs tabular-nums text-muted">{{ row.cardNumber }}</td>
                            <td class="px-3 py-1.5 font-medium">{{ row.cardName }}</td>
                            <td class="px-3 py-1.5 text-muted">{{ finishLabel(row.finish, row.pattern) }}</td>
                            <td class="px-3 py-1.5">
                                <UBadge color="neutral" variant="subtle" size="sm">{{ row.rarity || '—' }}</UBadge>
                            </td>
                            <td class="px-3 py-1.5 text-right font-mono tabular-nums">{{ formatPopulation(row.population) }}</td>
                            <td class="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted">{{ oneInPacks(row.population) }}</td>
                        </tr>
                        <tr v-if="populationRows.length === 0">
                            <td colspan="6" class="px-3 py-4 text-center text-sm text-muted">No cards match the filter</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Commit -->
        <section class="rounded-lg border border-default bg-elevated p-4">
            <template v-if="!committed">
                <p class="mb-3 text-sm text-muted">
                    Committing generates the run's secret key, freezes every sheet layout and impression
                    count, and publishes a commitment digest. Nothing about the run can change afterwards.
                </p>
                <UButton
                    icon="i-lucide-lock"
                    color="primary"
                    :disabled="!canCommit"
                    @click="confirmOpen = true"
                >
                    Commit print run
                </UButton>
                <p v-if="!canCommit && preview && preview.errors.length > 0" class="mt-2 text-xs text-muted">
                    Resolve the errors above before committing.
                </p>
                <div v-if="freshDigest" class="mt-3">
                    <div class="text-[11px] tracking-wider text-muted uppercase">Commitment digest</div>
                    <code class="font-mono text-xs break-all">{{ freshDigest }}</code>
                </div>
            </template>
            <template v-else>
                <div class="flex items-start gap-3">
                    <UIcon name="i-lucide-lock" class="mt-0.5 size-4 shrink-0 text-muted" />
                    <div class="min-w-0">
                        <p class="text-sm font-medium">
                            Print run committed — {{ detail.set.targetPackCount }} packs, {{ godCount }} god packs.
                        </p>
                        <p class="mt-1 text-xs text-muted">
                            Sheets and run parameters are permanently frozen.
                        </p>
                        <div class="mt-2">
                            <div class="text-[11px] tracking-wider text-muted uppercase">Commitment digest</div>
                            <code class="font-mono text-xs break-all">{{ digest }}</code>
                        </div>
                    </div>
                </div>
            </template>
        </section>

        <UModal v-model:open="confirmOpen" title="Commit print run">
            <template #body>
                <p class="text-sm">
                    This permanently freezes all sheets for
                    <span class="font-medium">{{ detail.set.name }}</span>:
                    <span class="font-mono tabular-nums">{{ runN }}</span> packs,
                    <span class="font-mono tabular-nums">{{ preview?.godPackCount ?? 0 }}</span> god packs.
                    There is no undo.
                </p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton color="neutral" variant="ghost" :disabled="committing" @click="confirmOpen = false">
                        Cancel
                    </UButton>
                    <UButton color="primary" icon="i-lucide-lock" :loading="committing" @click="commitRun">
                        Commit print run
                    </UButton>
                </div>
            </template>
        </UModal>
    </div>
</template>
