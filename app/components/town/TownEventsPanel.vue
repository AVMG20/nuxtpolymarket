<script setup lang="ts">
import TownAsset from '~/components/town/TownAsset.vue'
import TownCoin from '~/components/town/TownCoin.vue'
import { getTownResearch } from '#shared/utils/gamelogic/town-research'
import { TOWN_EVENTS_PAGE, TOWN_EVENTS_MAX_PAGE, type TownEvent } from '#shared/utils/gamelogic/town-events'

const props = defineProps<{
    catalogById: Map<string, { name: string }>
    resourceById: Map<string, { name: string }>
    /** Bumped by the parent whenever the town state refreshes, so a build that finishes while this is open lands in the list. */
    tick: number
}>()
const emit = defineEmits<{ close: [] }>()

const events = ref<TownEvent[]>([])
const more = ref(false)
const loading = ref(false)
const loaded = ref(false)

async function fetchPage(before: string | null, limit = TOWN_EVENTS_PAGE) {
    return $fetch<{ events: TownEvent[], more: boolean }>('/api/town/events' as string, { query: { before: before ?? undefined, limit } })
}

/**
 * Reload from the top. Asks for as many as are already shown, so a refresh
 * while the mayor has paged down keeps what they scrolled to and slots
 * anything new in at the right place.
 */
async function loadLatest() {
    loading.value = true
    try {
        const page = await fetchPage(null, Math.min(TOWN_EVENTS_MAX_PAGE, Math.max(TOWN_EVENTS_PAGE, events.value.length)))
        events.value = page.events
        more.value = page.more
        loaded.value = true
    } finally {
        loading.value = false
    }
}

async function loadMore() {
    const last = events.value[events.value.length - 1]
    if (!last || loading.value) return
    loading.value = true
    try {
        const page = await fetchPage(last.id)
        const seen = new Set(events.value.map(e => e.id))
        events.value = [...events.value, ...page.events.filter(e => !seen.has(e.id))]
        more.value = page.more
    } finally {
        loading.value = false
    }
}

onMounted(loadLatest)
watch(() => props.tick, () => { if (loaded.value) loadLatest() })

// Relative times drift, so the clock ticks while the window is open.
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 30_000) })
onBeforeUnmount(() => { if (clock) clearInterval(clock) })

function ago(at: number) {
    const s = Math.max(0, Math.round((now.value - at) / 1000))
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86_400)}d ago`
}

function buildingName(type: string) {
    return props.catalogById.get(type)?.name ?? type
}
function resourceName(id: string) {
    return props.resourceById.get(id)?.name ?? id
}
function fmtPrice(p: number) {
    return p >= 1000 ? formatNumber(p) : p.toFixed(2)
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div class="g-window-head">
            <h2>What happened</h2>
            <div class="flex gap-2">
                <button class="g-icon g-icon-sm" data-tip="Refresh" @click="loadLatest()">
                    <UIcon name="i-lucide-refresh-cw" :class="loading ? 'animate-spin' : ''" />
                </button>
                <button class="g-icon g-icon-sm" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
            </div>
        </div>
        <div class="g-window-body">
            <div v-if="!loaded" class="flex justify-center py-8"><span class="g-spinner" /></div>
            <div v-else-if="events.length === 0" class="g-empty">Nothing yet. Finished builds, banked research and filled offers show up here.</div>
            <div v-else class="space-y-1.5">
                <div v-for="e in events" :key="e.id" class="g-row ev" :class="`is-${e.data.kind}`">
                    <span class="ev-ico">
                        <TownAsset v-if="e.data.kind === 'built' || e.data.kind === 'upgraded'" :id="e.data.type" kind="building" :level="e.data.level" />
                        <TownAsset v-else-if="e.data.kind === 'trade'" :id="e.data.resource" />
                        <UIcon v-else name="i-lucide-microscope" />
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="ev-title">
                            <template v-if="e.data.kind === 'built'">{{ buildingName(e.data.type) }} built</template>
                            <template v-else-if="e.data.kind === 'upgraded'">{{ buildingName(e.data.type) }} is now level {{ e.data.level }}</template>
                            <template v-else-if="e.data.kind === 'research'">{{ getTownResearch(e.data.researchId)?.name ?? e.data.researchId }} researched</template>
                            <template v-else-if="e.data.side === 'buy'">Bought {{ formatNumber(e.data.quantity) }} {{ resourceName(e.data.resource) }}</template>
                            <template v-else>Sold {{ formatNumber(e.data.quantity) }} {{ resourceName(e.data.resource) }}</template>
                        </div>
                        <div class="ev-sub">
                            <template v-if="e.data.kind === 'trade'">
                                <span><TownCoin />{{ formatNumber(e.data.coins) }}</span>
                                <span>{{ fmtPrice(e.data.price) }} each</span>
                                <span>{{ e.data.done ? 'offer filled' : 'offer partly filled' }}</span>
                            </template>
                            <span>{{ ago(e.at) }}</span>
                        </div>
                    </div>
                </div>
                <button v-if="more" class="g-btn g-btn-sm ev-more" :disabled="loading" @click="loadMore">
                    {{ loading ? 'Loading…' : 'Load more' }}
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.ev { align-items: center; gap: 12px; background: var(--g-fill); }
.ev-ico {
    width: 36px; height: 36px; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 10px; background: var(--g-fill-2); font-size: 20px;
}
.ev.is-research .ev-ico { color: var(--g-accent); }
.ev-title { font-size: 13px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-sub {
    margin-top: 1px;
    display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px;
    font-size: 11px; color: var(--g-muted); font-variant-numeric: tabular-nums;
}
.ev-sub > span { display: inline-flex; align-items: center; gap: 3px; }
.ev-more { width: 100%; justify-content: center; margin-top: 4px; }
</style>
