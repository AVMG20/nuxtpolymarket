<script setup lang="ts">
import type { OpenedPackResult, SealedPackSummary, TcgSetDetailPayload } from '#shared/types/tcg'
import { legacySetOf } from '#shared/utils/tcg/legacy'

interface PacksPayload {
    packs: SealedPackSummary[]
    progress: {
        packsSold: number
        targetPackCount: number | null
        basePacksSold: number
        godPacksSold: number
        restockCount: number
    }
}

const props = defineProps<{ detail: TcgSetDetailPayload }>()
const emit = defineEmits<{ refresh: [] }>()

const { call } = useTcgAdmin()

const setId = computed(() => props.detail.set.id)
const committed = computed(() => props.detail.set.status === 'committed')

const { data, pending, refresh: refreshPacks } = useFetch<PacksPayload>(
    '/api/tcg/admin/debug/packs',
    {
        key: `tcg-debug-packs-${props.detail.set.id}`,
        query: computed(() => ({ setId: props.detail.set.id }))
    }
)

watch(() => props.detail, () => {
    refreshPacks()
})

const progress = computed(() => data.value?.progress)
const sealedPacks = computed(() => (data.value?.packs ?? []).filter(pack => pack.state === 'sealed'))
const openedPacks = computed(() => (data.value?.packs ?? []).filter(pack => pack.state === 'opened'))
const soldOut = computed(() => {
    const p = progress.value
    return Boolean(p?.targetPackCount && p.packsSold >= p.targetPackCount && p.restockCount === 0)
})

// ── Buy ──────────────────────────────────────────────────────────────────────

const buying = ref(false)

async function buyPack() {
    buying.value = true
    try {
        await call('/api/tcg/admin/debug/buy-pack', { setId: setId.value }, 'Pack purchased')
        await refreshPacks()
        emit('refresh')
    } catch {
        // toasted by call()
    } finally {
        buying.value = false
    }
}

// ── Open + reveal ────────────────────────────────────────────────────────────

// Contents are only returned by the open call itself, so re-viewing an opened
// pack works within this session; packs opened elsewhere list without cards.
const revealCache = reactive<Record<string, OpenedPackResult>>({})
const openingId = ref<string | null>(null)
const revealOpen = ref(false)
const reveal = ref<OpenedPackResult | null>(null)

async function openPack(pack: SealedPackSummary) {
    openingId.value = pack.id
    try {
        const result = await call('/api/tcg/admin/debug/open-pack', { packId: pack.id }, '') as OpenedPackResult
        revealCache[pack.id] = result
        reveal.value = result
        revealOpen.value = true
        await refreshPacks()
        emit('refresh')
    } catch {
        // toasted by call()
    } finally {
        openingId.value = null
    }
}

// ── Return to pool ───────────────────────────────────────────────────────────

const returnTarget = ref<SealedPackSummary | null>(null)
const returnOpen = ref(false)
const returning = ref(false)

function askReturn(pack: SealedPackSummary) {
    returnTarget.value = pack
    returnOpen.value = true
}

async function confirmReturn() {
    const pack = returnTarget.value
    if (!pack) return
    returning.value = true
    try {
        await call('/api/tcg/admin/debug/return-pack', { packId: pack.id }, 'Pack returned to the pool')
        delete revealCache[pack.id]
        returnOpen.value = false
        returnTarget.value = null
        await refreshPacks()
        emit('refresh')
    } catch {
        // toasted by call()
    } finally {
        returning.value = false
    }
}

function viewPack(pack: SealedPackSummary) {
    const cached = revealCache[pack.id]
    if (!cached) return
    reveal.value = cached
    revealOpen.value = true
}

function contentsSummary(pack: SealedPackSummary): string {
    const cached = revealCache[pack.id]
    if (!cached) return 'opened earlier — contents not on record here'
    const rare = cached.cards[cached.cards.length - 1]
    return `${cached.cards.length} cards — top pull ${rare?.name ?? '?'}`
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
}
</script>

<template>
    <div class="space-y-6">
        <p v-if="!committed" class="text-sm text-muted">
            Debug packs become available once the print run is committed.
        </p>

        <template v-else>
            <!-- Progress header -->
            <section class="rounded-lg border border-default bg-elevated px-4 py-3">
                <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
                    <div class="min-w-48 grow">
                        <div class="mb-1 flex items-baseline justify-between">
                            <span class="text-[11px] tracking-wider text-muted uppercase">Packs sold</span>
                            <span class="font-mono text-sm tabular-nums">
                                {{ progress?.packsSold ?? 0 }} / {{ progress?.targetPackCount ?? '—' }}
                            </span>
                        </div>
                        <UProgress
                            :model-value="progress?.packsSold ?? 0"
                            :max="progress?.targetPackCount ?? undefined"
                            size="sm"
                        />
                    </div>
                    <div>
                        <div class="text-[11px] tracking-wider text-muted uppercase">Base</div>
                        <div class="font-mono text-sm tabular-nums">{{ progress?.basePacksSold ?? 0 }}</div>
                    </div>
                    <div>
                        <div class="text-[11px] tracking-wider text-muted uppercase">God</div>
                        <div class="font-mono text-sm tabular-nums">{{ progress?.godPacksSold ?? 0 }}</div>
                    </div>
                    <UBadge
                        v-if="(progress?.restockCount ?? 0) > 0"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-rotate-ccw"
                    >
                        {{ progress?.restockCount }} reservation{{ progress?.restockCount === 1 ? '' : 's' }} in the restock pool
                    </UBadge>
                    <UButton
                        icon="i-lucide-shopping-bag"
                        color="primary"
                        :loading="buying"
                        :disabled="soldOut"
                        @click="buyPack"
                    >
                        {{ soldOut ? 'Sold out' : 'Buy pack' }}
                    </UButton>
                </div>
            </section>

            <!-- Sealed packs -->
            <section>
                <h3 class="mb-2 text-xs font-semibold tracking-widest text-muted uppercase">
                    Sealed packs
                    <span class="font-mono font-normal tabular-nums">({{ sealedPacks.length }})</span>
                </h3>
                <div v-if="pending && !data" class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
                    <USkeleton v-for="i in 4" :key="i" class="aspect-[0.62] rounded-lg" />
                </div>
                <p v-else-if="sealedPacks.length === 0" class="text-sm text-muted">
                    No sealed packs. Buy one to test the run.
                </p>
                <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
                    <div
                        v-for="pack in sealedPacks"
                        :key="pack.id"
                        class="relative flex aspect-[0.62] flex-col items-center justify-center gap-2 rounded-lg border border-default bg-elevated p-3"
                    >
                        <UBadge
                            v-if="pack.isGod"
                            color="warning"
                            variant="subtle"
                            size="sm"
                            icon="i-lucide-sparkles"
                            class="absolute top-2 right-2"
                        >
                            god
                        </UBadge>
                        <UIcon name="i-lucide-package" class="size-8 text-muted" />
                        <div class="font-mono text-xs tabular-nums text-muted">Pack #{{ pack.packIndex + 1 }}</div>
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="outline"
                            :loading="openingId === pack.id"
                            @click="openPack(pack)"
                        >
                            Open
                        </UButton>
                        <UButton
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-undo-2"
                            @click="askReturn(pack)"
                        >
                            Put back
                        </UButton>
                    </div>
                </div>
            </section>

            <!-- Opened packs -->
            <section v-if="openedPacks.length > 0">
                <h3 class="mb-2 text-xs font-semibold tracking-widest text-muted uppercase">
                    Opened packs
                    <span class="font-mono font-normal tabular-nums">({{ openedPacks.length }})</span>
                </h3>
                <ul class="divide-y divide-default rounded-lg border border-default">
                    <li
                        v-for="pack in openedPacks"
                        :key="pack.id"
                        class="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                        <span class="font-mono text-xs tabular-nums text-muted">#{{ pack.packIndex + 1 }}</span>
                        <UBadge v-if="pack.isGod" color="warning" variant="subtle" size="sm">god</UBadge>
                        <span class="truncate text-muted">{{ contentsSummary(pack) }}</span>
                        <span class="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted">{{ formatDate(pack.createdAt) }}</span>
                        <UButton
                            v-if="revealCache[pack.id]"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-eye"
                            @click="viewPack(pack)"
                        >
                            View
                        </UButton>
                        <UButton
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-undo-2"
                            class="shrink-0"
                            @click="askReturn(pack)"
                        >
                            Put back
                        </UButton>
                    </li>
                </ul>
            </section>
        </template>

        <!-- Return confirm modal -->
        <UModal
            v-model:open="returnOpen"
            :title="returnTarget ? `Put pack #${returnTarget.packIndex + 1} back?` : 'Put pack back?'"
        >
            <template #body>
                <p class="text-sm text-muted">
                    The pack{{ returnTarget?.state === 'opened' ? ' and all of its cards' : '' }}
                    will be removed. The reservation returns to the pool and will randomly
                    resurface in a future pack.
                </p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton color="neutral" variant="ghost" @click="returnOpen = false">
                        Cancel
                    </UButton>
                    <UButton color="error" icon="i-lucide-undo-2" :loading="returning" @click="confirmReturn">
                        Put back
                    </UButton>
                </div>
            </template>
        </UModal>

        <!-- Reveal modal -->
        <UModal
            v-model:open="revealOpen"
            :title="reveal ? `Pack contents${reveal.isGod ? ' — god pack' : ''}` : 'Pack contents'"
            :ui="{ content: 'max-w-5xl' }"
        >
            <template #body>
                <div v-if="reveal" class="overflow-x-auto">
                    <div class="flex w-max gap-4 pb-2">
                        <div
                            v-for="card in reveal.cards"
                            :key="card.copyId"
                            class="flex w-max flex-col items-center gap-1.5"
                        >
                            <ClientOnly>
                                <TcgCard
                                    :bundle="card.bundle"
                                    :asset-number="String(card.assetNumber)"
                                    :mask-kind="card.maskKind ?? 'wp'"
                                    :foil-effect="card.foilEffect"
                                    :pattern="card.pattern"
                                    :legacy-set="card.bundle ? null : legacySetOf(card.plaatjesCardId)"
                                    :holo="card.finish === 'holo'"
                                    :height="300"
                                />
                                <template #fallback>
                                    <USkeleton class="h-[300px] w-[215px] rounded-xl" />
                                </template>
                            </ClientOnly>
                            <div class="max-w-[215px] truncate text-sm font-medium">{{ card.name }}</div>
                            <div class="flex items-center gap-1.5">
                                <UBadge color="neutral" variant="subtle" size="sm">{{ card.rarity || '—' }}</UBadge>
                                <UBadge v-if="card.pattern" color="warning" variant="subtle" size="sm">{{ card.pattern }}</UBadge>
                            </div>
                            <div class="font-mono text-xs tabular-nums text-muted">{{ card.serial }}</div>
                        </div>
                    </div>
                </div>
            </template>
        </UModal>
    </div>
</template>
