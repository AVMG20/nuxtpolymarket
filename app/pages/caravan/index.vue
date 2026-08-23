<script setup lang="ts">
import {
    BASE_NODE_CAPACITY, CATEGORIES, CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_NAMES,
    MAX_NODE_CAPACITY, MAX_PRIORITY, MAX_ROAD_LEVEL, PRIORITY_COLORS, PRIORITY_LABELS,
    RESOURCES, ROAD_COLORS, ROAD_NAMES, TIERS, capacityCoinCost, capacityResourceCost, capacityUpgradeTier,
    nodeCost, roadCost, roadResourceCost, roadSpeedMultiplier, roadUpgradeTier
} from '#shared/utils/caravan/config'
import { homeDistanceMap, nodeRichness, partyPower, projectRates } from '#shared/utils/caravan/sim'
import { isReachable } from '#shared/utils/caravan/world'
import { combatPower, derivedStats, isSpecialist } from '#shared/utils/caravan/workers'
import type { NodeId } from '#shared/utils/caravan/types'

/**
 * The map screen. The Pixi canvas fills the viewport; every interaction opens
 * the same right-hand drawer, which re-skins itself for whatever was clicked.
 */

const {
    state, world, events, serverNow, bonuses,
    purchaseNode, upgradeRoad, assault, setPriority, upgradeCapacity, recallNode
} = useCaravan()
const { user } = useAuth()

const selectedNode = ref<NodeId | null>(null)
const selectedEdge = ref<string | null>(null)
const mapRef = ref<{ fitToTerritory: () => void, focusNode: (id: NodeId) => void } | null>(null)
const party = ref<string[]>([])

const drawerOpen = computed({
    get: () => selectedNode.value !== null || selectedEdge.value !== null,
    set: (value: boolean) => { if (!value) clearSelection() }
})

function clearSelection() {
    selectedNode.value = null
    selectedEdge.value = null
    party.value = []
}

function onSelectNode(id: NodeId) {
    selectedEdge.value = null
    selectedNode.value = id
    party.value = []
}

const balance = computed(() => Number.parseFloat(user.value?.balance ?? '0'))
const node = computed(() => (selectedNode.value === null ? null : world.value.nodes[selectedNode.value] ?? null))
const owned = computed(() => new Set(state.value?.ownedNodes ?? []))
const passable = computed(() => new Set([...(state.value?.ownedNodes ?? []), ...(state.value?.clearedCamps ?? [])]))
const isOwned = computed(() => (node.value ? owned.value.has(node.value.id) : false))
const isCleared = computed(() => (node.value ? (state.value?.clearedCamps ?? []).includes(node.value.id) : false))

const cost = computed(() => nodeCost((state.value?.ownedNodes.length ?? 1) - 1))
const reachable = computed(() => (node.value ? isReachable(world.value, node.value.id, passable.value) : false))
const tierDef = computed(() => (node.value ? TIERS[node.value.tier - 1] ?? TIERS[0]! : TIERS[0]!))

const richness = computed(() => {
    if (!node.value || !state.value || node.value.kind !== 'resource') return 1
    return nodeRichness(state.value, node.value, serverNow(), bonuses.value?.regenRate ?? 0)
})

const availableWorkers = computed(() => state.value?.workers ?? [])

/** Travel seconds home from every node, at base speed, with roads applied. */
const homeDistances = computed(() => (state.value ? homeDistanceMap(state.value, world.value) : new Map<number, number>()))

/**
 * Always two segments, so the column never jumps between "45s" and "2h 15m 3s".
 */
function duration(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000))
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    return `0m ${seconds}s`
}

/**
 * Who is working the selected seam, how far through their current job they are,
 * and when they will next be standing in a capital with their pack empty. That
 * last number is the one that actually answers "can I switch this node yet".
 */
const workingHere = computed(() => {
    if (!state.value || selectedNode.value === null || !bonuses.value) return []
    const nodeId = selectedNode.value
    const travelHome = homeDistances.value.get(nodeId) ?? 0

    return state.value.workers
        .filter(w => w.assignment === nodeId)
        .map((worker) => {
            const stats = derivedStats(worker, state.value!.items, bonuses.value!)
            const activity = worker.activity
            const homeMs = (travelHome / stats.speed) * 1000

            let label = 'Waiting'
            let progress = 0
            let etaMs = homeMs

            if (activity.type === 'harvest') {
                const span = Math.max(1, activity.doneAt - activity.startedAt)
                progress = Math.max(0, Math.min(1, (tickNow.value - activity.startedAt) / span))
                label = 'Cutting'
                etaMs = Math.max(0, activity.doneAt - tickNow.value) + homeMs
            } else if (activity.type === 'travel') {
                const span = Math.max(1, activity.arrivesAt - activity.startedAt)
                progress = Math.max(0, Math.min(1, (tickNow.value - activity.startedAt) / span))
                const outbound = activity.to === nodeId
                label = outbound ? 'On the way' : 'Hauling home'
                etaMs = Math.max(0, activity.arrivesAt - tickNow.value) + (outbound ? homeMs : 0)
            } else if (activity.type === 'unload') {
                label = 'Unloading'
                progress = 1
                etaMs = Math.max(0, activity.doneAt - tickNow.value)
            } else if (activity.type === 'starving') {
                label = 'Out of rations'
            }

            const carried = Object.values(worker.cargo).reduce((sum, n) => sum + n, 0)
            return { worker, label, progress, eta: duration(etaMs), carried, stats }
        })
})

const priority = computed(() =>
    selectedNode.value === null ? 0 : state.value?.nodePriority?.[selectedNode.value] ?? 1
)

const capacity = computed(() =>
    (selectedNode.value === null ? BASE_NODE_CAPACITY : state.value?.nodeCapacity?.[selectedNode.value] ?? BASE_NODE_CAPACITY)
    + (bonuses.value?.nodeCapacity ?? 0)
)

/** The stored widening level, which is what the next upgrade prices off. */
const capacityLevel = computed(() =>
    selectedNode.value === null ? BASE_NODE_CAPACITY : state.value?.nodeCapacity?.[selectedNode.value] ?? BASE_NODE_CAPACITY
)

const capacityCost = computed(() => {
    if (!node.value) return null
    const level = capacityLevel.value
    if (level >= MAX_NODE_CAPACITY) return null
    return {
        coins: capacityCoinCost(level, node.value.tier),
        resources: capacityResourceCost(level),
        tier: capacityUpgradeTier(level)
    }
})

const canWiden = computed(() => {
    if (!capacityCost.value || !state.value) return false
    if (state.value.tier < capacityCost.value.tier) return false
    if (balance.value < capacityCost.value.coins) return false
    return Object.entries(capacityCost.value.resources).every(([id, count]) => (state.value!.resources[id] ?? 0) >= count)
})

/** The category of the selected seam, for the specialist hints. */
const nodeCategory = computed(() => (node.value?.resource ? RESOURCES[node.value.resource]?.category ?? null : null))

const specialistCount = computed(() =>
    node.value?.resource
        ? (state.value?.workers ?? []).filter(w => isSpecialist(w, node.value!.resource)).length
        : 0
)

/** Roads leaving the selected node, with what an upgrade would buy. */
const roads = computed(() => {
    if (!node.value || !state.value) return []
    return world.value.edges
        .filter(e => e.a === node.value!.id || e.b === node.value!.id)
        .map((edge) => {
            const otherId = edge.a === node.value!.id ? edge.b : edge.a
            const level = state.value!.roads[edge.id] ?? 0
            const resources = level < MAX_ROAD_LEVEL ? roadResourceCost(level) : {}
            return {
                edge,
                level,
                other: world.value.nodes[otherId]!,
                linked: passable.value.has(edge.a) && passable.value.has(edge.b),
                cost: roadCost(level),
                resources,
                requiredTier: roadUpgradeTier(level),
                affordable: balance.value >= roadCost(level)
                    && Object.entries(resources).every(([id, count]) => (state.value?.resources[id] ?? 0) >= count),
                current: roadSpeedMultiplier(level),
                next: roadSpeedMultiplier(level + 1)
            }
        })
        .sort((a, b) => a.edge.length - b.edge.length)
})

const partyPowerTotal = computed(() => (state.value ? partyPower(state.value, party.value) : 0))

function workerPower(workerId: string): number {
    const worker = state.value?.workers.find(w => w.id === workerId)
    if (!worker || !state.value || !bonuses.value) return 0
    return combatPower(derivedStats(worker, state.value.items, bonuses.value))
}

// The persisted log rather than just this catch-up's events, so navigating away
// and back does not wipe the history.
const feed = computed(() => {
    const entries = state.value?.log?.length ? state.value.log : events.value
    return [...entries].reverse().slice(0, 8)
})

const rootEl = ref<HTMLElement | null>(null)
const hover = ref<{ id: NodeId, x: number, y: number } | null>(null)

/** Everything the hover card needs, resolved once per hovered node. */
const hovered = computed(() => {
    if (!hover.value || !state.value) return null
    const node = world.value.nodes[hover.value.id]
    if (!node) return null
    const isOwned = owned.value.has(node.id)
    const tierDef = TIERS[node.tier - 1] ?? TIERS[0]!
    return {
        node,
        tierDef,
        isOwned,
        cleared: state.value.clearedCamps.includes(node.id),
        richness: node.kind === 'resource'
            ? nodeRichness(state.value, node, tickNow.value, bonuses.value?.regenRate ?? 0)
            : null,
        workers: state.value.workers.filter(w => w.assignment === node.id).length,
        reachable: isReachable(world.value, node.id, passable.value),
        locked: node.tier > state.value.tier
    }
})

const holdingsOpen = ref(false)
const search = ref('')

/**
 * Finding one seam among a hundred and twenty by panning is miserable. Typing
 * two letters and pressing enter is not. Owned nodes rank first because those
 * are the ones you are steering.
 */
const searchResults = computed(() => {
    const query = search.value.trim().toLowerCase()
    if (query.length < 2) return []
    return world.value.nodes
        .filter(node => node.name.toLowerCase().includes(query))
        .map(node => ({
            node,
            owned: owned.value.has(node.id),
            resource: node.resource ? RESOURCES[node.resource]?.name : null
        }))
        .sort((a, b) => Number(b.owned) - Number(a.owned) || a.node.name.localeCompare(b.node.name))
        .slice(0, 8)
})

function goTo(id: NodeId) {
    onSelectNode(id)
    mapRef.value?.focusNode(id)
    search.value = ''
}

/**
 * Every resource node you hold, worst seam first. Once the map has twenty owned
 * nodes, hunting for the drained one by eye is the tedious part -- this puts the
 * ones that need attention at the top and jumps the camera to them.
 */
const holdings = computed(() => {
    if (!state.value) return []
    return state.value.ownedNodes
        .map(id => world.value.nodes[id]!)
        .filter(node => node?.kind === 'resource')
        .map(node => ({
            node,
            richness: nodeRichness(state.value!, node, tickNow.value, bonuses.value?.regenRate ?? 0),
            workers: state.value!.workers.filter(w => w.assignment === node.id).length,
            capacity: (state.value!.nodeCapacity?.[node.id] ?? BASE_NODE_CAPACITY) + (bonuses.value?.nodeCapacity ?? 0),
            priority: state.value!.nodePriority?.[node.id] ?? 1
        }))
        // Highest priority first, then the most drained -- the two reasons to look.
        .sort((a, b) => b.priority - a.priority || a.richness - b.richness)
})

const legend = [
    { label: 'Capital', hint: 'Where workers deliver', shape: 'capital' },
    { label: 'For sale', hint: 'Borders your territory', shape: 'frontier' },
    { label: 'Camp', hint: 'Blocks the road until cleared', shape: 'camp' }
] as const

/** Road stages, so the colours on the map mean something without hovering. */
const roadStages = ROAD_NAMES.map((name, level) => ({ name, level, color: ROAD_COLORS[level]! }))

/** The trade colours used for node marks, so the map can be read at a glance. */
const trades = CATEGORIES.map(category => ({
    category,
    name: CATEGORY_NAMES[category],
    color: CATEGORY_COLORS[category],
    icon: CATEGORY_ICONS[category]
}))

/**
 * Throughput readout. Recomputed only when the state snapshot changes, not per
 * frame -- it runs half an hour of simulation to produce the number.
 */
const rates = computed(() => {
    if (!state.value) return null
    return projectRates(state.value, world.value)
})

/** Seconds left on any assault currently under way, for the camp drawer. */
const assaultCountdown = computed(() => {
    if (!node.value || node.value.kind !== 'camp') return null
    const party = (state.value?.workers ?? []).filter(w =>
        w.activity.type === 'assault' && w.activity.at === node.value!.id
    )
    if (!party.length) return null
    const resolvesAt = Math.min(...party.map(w => (w.activity as { resolvesAt: number }).resolvesAt))
    return { count: party.length, seconds: Math.max(0, Math.ceil((resolvesAt - tickNow.value) / 1000)) }
})

// A one-second heartbeat, only for countdown text. The Pixi canvas has its own
// render loop and does not need Vue to re-render for animation.
const tickNow = ref(Date.now())
let heartbeat: ReturnType<typeof setInterval> | null = null
function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') clearSelection()
}

onMounted(() => {
    heartbeat = setInterval(() => { tickNow.value = serverNow() }, 1000)
    window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
    if (heartbeat) clearInterval(heartbeat)
    window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
    <div ref="rootEl" class="absolute inset-0">
        <CaravanMap
            ref="mapRef"
            :world="world"
            :state="state"
            :server-now="serverNow"
            :selected-node="selectedNode"
            :selected-edge="selectedEdge"
            @select-node="onSelectNode"
            @select-edge="(id: string) => { selectedNode = null; selectedEdge = id }"
            @clear-selection="clearSelection"
            @hover-node="(v) => hover = v"
        />

        <!-- Hover card. Positioned in screen space from the Pixi pointer event,
             and flipped away from the edges so it never runs off the canvas. -->
        <div
            v-if="hovered"
            class="pointer-events-none absolute z-30 w-52 rounded-lg border border-default/70 bg-elevated/95 px-3 py-2 shadow-lg backdrop-blur"
            :style="{
                left: `${Math.min(hover!.x + 18, 10000)}px`,
                top: `${hover!.y + 18}px`,
                transform: hover!.x > (rootEl?.offsetWidth ?? 1200) * 0.62 ? 'translateX(calc(-100% - 36px))' : undefined
            }"
        >
            <div class="text-sm font-semibold" :style="{ color: hovered.tierDef.glow }">{{ hovered.node.name }}</div>
            <div class="text-[11px] uppercase tracking-wide text-muted">
                {{ hovered.node.kind === 'capital'
                    ? 'Capital'
                    : hovered.node.kind === 'camp'
                        ? 'Enemy camp'
                        : RESOURCES[hovered.node.resource!]?.name }}
                · {{ hovered.tierDef.name }}
            </div>

            <div class="mt-1.5 space-y-1 text-xs">
                <div v-if="hovered.richness !== null" class="flex items-center justify-between">
                    <span class="text-muted">Deposit</span>
                    <span
                        class="font-mono"
                        :class="hovered.richness > 0.5 ? 'text-success' : hovered.richness > 0.25 ? 'text-warning' : 'text-error'"
                    >{{ Math.round(hovered.richness * 100) }}%</span>
                </div>
                <div v-if="hovered.isOwned && hovered.node.kind === 'resource'" class="flex items-center justify-between">
                    <span class="text-muted">Working it</span>
                    <span class="font-mono">{{ hovered.workers }}</span>
                </div>
                <div v-if="hovered.node.kind === 'camp' && !hovered.cleared" class="flex items-center justify-between">
                    <span class="text-muted">Defence</span>
                    <span class="font-mono text-error">{{ formatNumber(hovered.node.power ?? 0) }}</span>
                </div>
                <div v-else-if="hovered.node.kind === 'camp'" class="text-primary">Cleared</div>
                <div v-if="!hovered.isOwned && hovered.node.kind !== 'camp'" class="flex items-center justify-between">
                    <span class="text-muted">Claim</span>
                    <span
                        class="font-mono"
                        :class="hovered.locked || !hovered.reachable || balance < cost ? 'text-error' : 'text-primary'"
                    >
                        {{ hovered.locked ? `Tier ${hovered.node.tier}` : hovered.reachable ? formatNumber(cost) : 'No route' }}
                    </span>
                </div>
            </div>
        </div>

        <!-- One HUD card rather than three floating boxes. -->
        <div class="pointer-events-auto absolute left-4 top-4 z-10 w-64 overflow-hidden rounded-xl border border-default/60 bg-elevated/70 backdrop-blur">
            <!-- Search sits at the top of the HUD because it is the fastest way
                 to get anywhere once the map is wider than the screen. -->
            <div class="relative border-b border-default/50 px-2 py-2">
                <UInput
                    v-model="search"
                    icon="i-lucide-search"
                    size="xs"
                    placeholder="Find a node…"
                    class="w-full"
                    @keydown.enter="searchResults[0] && goTo(searchResults[0].node.id)"
                    @keydown.escape="search = ''"
                />
                <div
                    v-if="searchResults.length"
                    class="absolute inset-x-2 top-full z-20 mt-1 overflow-hidden rounded-lg border border-default/60 bg-elevated/95 backdrop-blur"
                >
                    <button
                        v-for="result in searchResults"
                        :key="result.node.id"
                        type="button"
                        class="flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-default/50"
                        @click="goTo(result.node.id)"
                    >
                        <span class="flex min-w-0 items-center gap-1.5">
                            <span
                                class="size-1.5 shrink-0 rounded-full"
                                :style="{ backgroundColor: TIERS[result.node.tier - 1]?.color }"
                            />
                            <span class="truncate" :class="result.owned ? 'text-default' : 'text-muted'">
                                {{ result.node.name }}
                            </span>
                        </span>
                        <span class="shrink-0 text-[10px] text-muted">
                            {{ result.owned ? 'yours' : result.resource ?? result.node.kind }}
                        </span>
                    </button>
                </div>
            </div>

            <div class="flex items-start justify-between gap-2 px-3 py-2.5">
                <div class="text-xs">
                    <div class="mb-1 font-medium text-default">Territory</div>
                    <div class="text-muted">{{ state?.ownedNodes.length ?? 0 }} nodes · {{ state?.capitals.length ?? 0 }}/{{ bonuses?.maxCapitals ?? 1 }} capitals</div>
                    <div class="text-muted">{{ state?.workers.length ?? 0 }}/{{ bonuses?.maxWorkers ?? 3 }} workers</div>
                    <div v-if="rates" class="mt-1.5 flex items-center gap-1.5 text-primary">
                        <UIcon name="i-lucide-trending-up" class="size-3" />
                        <span class="font-mono font-semibold">{{ formatNumber(rates.harvestValuePerHour) }}</span>
                        <span class="text-muted">/ hr</span>
                    </div>
                    <div v-if="rates" class="text-muted">harvest value · {{ formatNumber(rates.tripsPerHour) }} trips / hr</div>
                </div>
                <UTooltip text="Frame your territory">
                    <UButton
                        icon="i-lucide-crosshair"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        aria-label="Centre the map"
                        @click="mapRef?.fitToTerritory()"
                    />
                </UTooltip>
            </div>

            <div class="border-t border-default/50 px-1 py-1">
                <div class="px-1.5 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                    What now
                </div>
                <CaravanObjectives @focus-node="(id) => { onSelectNode(id); mapRef?.focusNode(id) }" />
            </div>

            <button
                type="button"
                class="flex w-full items-center justify-between border-t border-default/50 px-3 py-2 text-xs transition hover:bg-default/30"
                @click="holdingsOpen = !holdingsOpen"
            >
                <span class="font-medium text-default">Holdings</span>
                <span class="flex items-center gap-1.5 text-muted">
                    {{ holdings.length }}
                    <UIcon :name="holdingsOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
                </span>
            </button>

            <div
                v-if="holdingsOpen"
                class="max-h-[20rem] overflow-y-auto border-t border-default/40 p-1"
            >
                <p v-if="!holdings.length" class="px-2 py-3 text-xs text-muted">
                    You only hold the capital. Claim a seam next to it.
                </p>
                <button
                    v-for="entry in holdings"
                    :key="entry.node.id"
                    type="button"
                    class="w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition hover:bg-default/50"
                    :class="{ 'bg-default/40': selectedNode === entry.node.id }"
                    @click="onSelectNode(entry.node.id); mapRef?.focusNode(entry.node.id)"
                >
                    <div class="flex items-center justify-between gap-2 text-xs">
                        <span class="truncate">{{ entry.node.name }}</span>
                        <span class="flex shrink-0 items-center gap-2">
                            <span
                                class="rounded px-1 text-[10px] font-medium"
                                :style="{ color: PRIORITY_COLORS[entry.priority], backgroundColor: PRIORITY_COLORS[entry.priority] + '22' }"
                            >{{ PRIORITY_LABELS[entry.priority] }}</span>
                            <span class="text-muted">
                                {{ entry.workers }}/{{ entry.capacity }}
                            </span>
                        </span>
                    </div>
                    <div class="mt-1 h-1 overflow-hidden rounded-full bg-default/60">
                        <div
                            class="h-full rounded-full"
                            :class="entry.richness > 0.5 ? 'bg-success' : entry.richness > 0.25 ? 'bg-warning' : 'bg-error'"
                            :style="{ width: `${entry.richness * 100}%` }"
                        />
                    </div>
                </button>
            </div>
        </div>

        <!-- Legend -->
        <div class="pointer-events-none absolute bottom-4 left-4 z-10 hidden rounded-lg border border-default/60 bg-elevated/70 px-3 py-2 backdrop-blur lg:block">
            <div class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Trades</div>
            <div class="mb-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <div v-for="trade in trades" :key="trade.category" class="flex items-center gap-1.5 text-[11px]">
                    <UIcon :name="trade.icon" class="size-3" :style="{ color: trade.color }" />
                    <span class="text-default">{{ trade.name }}</span>
                </div>
            </div>
            <div class="mb-2 space-y-1 border-t border-default/40 pt-1.5">
                <div class="text-[10px] uppercase tracking-wide text-muted">Roads</div>
                <div class="flex items-center gap-2">
                    <span
                        v-for="stage in roadStages"
                        :key="stage.level"
                        class="h-1 flex-1 rounded-full"
                        :style="{ backgroundColor: stage.color }"
                        :title="stage.name"
                    />
                </div>
                <div class="flex justify-between text-[10px] text-muted">
                    <span>{{ roadStages[0]!.name }}</span>
                    <span>{{ roadStages[roadStages.length - 1]!.name }}</span>
                </div>
            </div>

            <div class="space-y-1 border-t border-default/40 pt-1.5">
                <div v-for="item in legend" :key="item.label" class="flex items-center gap-2 text-[11px]">
                    <span
                        v-if="item.shape === 'camp'"
                        class="size-2.5 shrink-0 bg-error"
                        style="clip-path: polygon(0 0, 100% 50%, 0 100%)"
                    />
                    <span
                        v-else-if="item.shape === 'capital'"
                        class="size-2.5 shrink-0 rotate-45 bg-primary"
                    />
                    <span
                        v-else
                        class="size-2.5 shrink-0 rounded-full border border-muted"
                    />
                    <span class="text-default">{{ item.label }}</span>
                    <span class="text-muted">{{ item.hint }}</span>
                </div>
            </div>
        </div>

        <!-- Event feed -->
        <div v-if="feed.length" class="pointer-events-none absolute bottom-4 right-4 z-10 w-72 space-y-1 text-right">
            <div
                v-for="(entry, index) in feed"
                :key="`${entry.at}-${index}`"
                class="rounded-md border border-default/50 bg-elevated/70 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur"
                :class="{ 'text-primary': entry.kind === 'camp-cleared', 'text-error': entry.kind === 'starved' || entry.kind === 'camp-failed' }"
            >
                {{ entry.text }}
            </div>
        </div>

        <USlideover v-model:open="drawerOpen" side="right" :ui="{ content: 'max-w-md w-full' }">
            <template #content>
                <div v-if="node" class="flex h-full flex-col">
                    <div
                        class="border-b border-default/60 px-5 py-4"
                        :style="{ background: `linear-gradient(135deg, ${tierDef.color}22, transparent)` }"
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <div class="text-lg font-semibold" :style="{ color: tierDef.glow }">{{ node.name }}</div>
                                <div class="text-xs uppercase tracking-wide text-muted">
                                    {{ node.kind === 'capital' ? 'Capital' : node.kind === 'camp' ? 'Enemy Camp' : RESOURCES[node.resource!]?.name }}
                                    · {{ tierDef.name }}
                                </div>
                            </div>
                            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" @click="clearSelection" />
                        </div>
                    </div>

                    <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                        <!-- Purchase -->
                        <div v-if="!isOwned && node.kind !== 'camp'" class="space-y-3">
                            <p class="text-sm text-muted">
                                <template v-if="node.tier > (state?.tier ?? 1)">
                                    Locked until you reach tier {{ node.tier }}.
                                </template>
                                <template v-else-if="!reachable">
                                    Nothing you own borders this node yet.
                                </template>
                                <template v-else>
                                    Claim this {{ node.kind === 'capital' ? 'capital' : 'site' }} to route workers through it.
                                </template>
                            </p>
                            <UButton
                                block
                                icon="i-lucide-flag"
                                :label="`Claim for ${formatNumber(cost)}`"
                                :disabled="!reachable || node.tier > (state?.tier ?? 1) || balance < cost"
                                @click="purchaseNode(node.id)"
                            />
                        </div>

                        <!-- Camp -->
                        <div v-if="node.kind === 'camp'" class="space-y-4">
                            <div v-if="isCleared" class="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
                                This camp has been cleared. The road through it is open.
                            </div>
                            <div
                                v-else-if="assaultCountdown"
                                class="rounded-lg border border-warning/40 bg-warning/5 px-3 py-3 text-sm"
                            >
                                <div class="font-medium text-warning">
                                    {{ assaultCountdown.count }} {{ assaultCountdown.count === 1 ? 'worker is' : 'workers are' }} storming the camp
                                </div>
                                <p class="mt-1 text-xs text-muted">
                                    Resolves in {{ assaultCountdown.seconds }}s. You can close this and the fight still plays out.
                                </p>
                            </div>

                            <template v-else>
                                <div class="rounded-lg border border-error/40 bg-error/5 px-3 py-3">
                                    <div class="flex items-baseline justify-between">
                                        <span class="text-xs uppercase tracking-wide text-muted">Defence</span>
                                        <span class="font-mono text-lg font-bold text-error">{{ formatNumber(node.power ?? 0) }}</span>
                                    </div>
                                    <p class="mt-1 text-xs text-muted">
                                        Send a party whose combined combat power beats this. Come in under it and they get driven back.
                                    </p>
                                </div>

                                <div class="space-y-2">
                                    <div class="text-xs font-medium uppercase tracking-wide text-muted">War party</div>
                                    <label
                                        v-for="worker in availableWorkers"
                                        :key="worker.id"
                                        class="flex cursor-pointer items-center gap-3 rounded-lg border border-default/60 px-3 py-2 transition hover:border-default"
                                        :class="{ 'border-primary/60 bg-primary/5': party.includes(worker.id) }"
                                    >
                                        <UCheckbox
                                            :model-value="party.includes(worker.id)"
                                            @update:model-value="(v: boolean | 'indeterminate') => party = v === true ? [...party, worker.id] : party.filter(id => id !== worker.id)"
                                        />
                                        <span class="size-2.5 rounded-full" :style="{ backgroundColor: TIERS[worker.tier - 1]?.color }" />
                                        <span class="flex-1 truncate text-sm">{{ worker.name }}</span>
                                        <span class="font-mono text-sm text-error">{{ formatNumber(workerPower(worker.id)) }}</span>
                                    </label>
                                </div>

                                <div class="flex items-center justify-between rounded-lg bg-elevated px-3 py-2 text-sm">
                                    <span class="text-muted">Party power</span>
                                    <span
                                        class="font-mono font-bold"
                                        :class="partyPowerTotal >= (node.power ?? 0) ? 'text-success' : 'text-error'"
                                    >{{ formatNumber(partyPowerTotal) }}</span>
                                </div>

                                <UButton
                                    block
                                    color="error"
                                    icon="i-lucide-swords"
                                    label="Assault the camp"
                                    :disabled="!party.length || node.tier > (state?.tier ?? 1)"
                                    @click="assault(node.id, party).then(clearSelection)"
                                />
                            </template>

                            <div v-if="node.loot" class="space-y-1.5">
                                <div class="text-xs font-medium uppercase tracking-wide text-muted">Spoils</div>
                                <CoinBalance :value="node.loot.coins" class="text-sm" />
                                <CaravanResource
                                    v-for="(count, id) in node.loot.resources"
                                    :key="id"
                                    :id="id"
                                    :amount="count"
                                    class="flex w-full justify-between"
                                />
                            </div>
                        </div>

                        <!-- Resource node -->
                        <div v-if="isOwned && node.kind === 'resource'" class="space-y-4">
                            <div>
                                <div class="mb-1.5 flex items-baseline justify-between text-xs">
                                    <span class="uppercase tracking-wide text-muted">Deposit</span>
                                    <span class="font-mono" :class="richness > 0.5 ? 'text-success' : richness > 0.25 ? 'text-warning' : 'text-error'">
                                        {{ Math.round(richness * 100) }}%
                                    </span>
                                </div>
                                <div class="h-2 overflow-hidden rounded-full bg-elevated">
                                    <div
                                        class="h-full rounded-full transition-all"
                                        :style="{ width: `${richness * 100}%`, backgroundColor: tierDef.color }"
                                    />
                                </div>
                                <p class="mt-1.5 text-xs text-muted">
                                    Over-harvesting drains the deposit and slows every trip. It grows back on its own while you work elsewhere.
                                </p>
                            </div>

                            <!-- Priority is the only lever over where workers go. -->
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <span class="text-xs font-medium uppercase tracking-wide text-muted">Priority</span>
                                    <span
                                        class="text-xs font-semibold"
                                        :style="{ color: PRIORITY_COLORS[priority] }"
                                    >{{ PRIORITY_LABELS[priority] }}</span>
                                </div>
                                <div class="grid grid-cols-6 gap-1">
                                    <button
                                        v-for="level in MAX_PRIORITY + 1"
                                        :key="level"
                                        type="button"
                                        class="cursor-pointer rounded-md border px-1 py-1.5 text-[10px] font-medium transition"
                                        :style="priority === level - 1
                                            ? { borderColor: PRIORITY_COLORS[level - 1], color: PRIORITY_COLORS[level - 1], backgroundColor: PRIORITY_COLORS[level - 1] + '1f' }
                                            : { borderColor: 'transparent' }"
                                        :class="priority === level - 1 ? '' : 'bg-default/40 text-muted hover:text-default'"
                                        @click="setPriority(node!.id, level - 1)"
                                    >{{ PRIORITY_LABELS[level - 1] }}</button>
                                </div>
                                <p class="text-xs text-muted">
                                    Workers fill the highest priority that still has room. Specialists read their own
                                    trade one step higher than it is set.
                                </p>
                            </div>

                            <!-- Capacity -->
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <span class="text-xs font-medium uppercase tracking-wide text-muted">Room at the seam</span>
                                    <span class="font-mono text-sm">
                                        <span :class="workingHere.length >= capacity ? 'text-warning' : 'text-default'">{{ workingHere.length }}</span>
                                        <span class="text-muted"> / {{ capacity }}</span>
                                    </span>
                                </div>

                                <div v-if="!workingHere.length" class="text-xs text-muted">Nobody is cutting here.</div>
                                <div v-else class="space-y-1.5">
                                    <div
                                        v-for="entry in workingHere"
                                        :key="entry.worker.id"
                                        class="rounded-lg border border-default/50 px-2.5 py-2"
                                    >
                                        <div class="flex items-center gap-1.5 text-xs">
                                            <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: TIERS[entry.worker.tier - 1]?.color }" />
                                            <span class="truncate font-medium">{{ entry.worker.name }}</span>
                                            <UIcon
                                                v-if="isSpecialist(entry.worker, node.resource)"
                                                :name="nodeCategory ? CATEGORY_ICONS[nodeCategory] : 'i-lucide-star'"
                                                class="size-3 shrink-0"
                                                :style="{ color: nodeCategory ? CATEGORY_COLORS[nodeCategory] : undefined }"
                                            />
                                            <span class="ml-auto shrink-0 font-mono text-[11px] text-muted">{{ entry.eta }}</span>
                                        </div>
                                        <div class="mt-1 flex items-baseline justify-between text-[11px] text-muted">
                                            <span>{{ entry.label }}</span>
                                            <span v-if="entry.carried" class="text-primary">carrying {{ formatNumber(entry.carried) }}</span>
                                            <span v-else>{{ Math.round(entry.progress * 100) }}%</span>
                                        </div>
                                        <div class="mt-1 h-1 overflow-hidden rounded-full bg-default/60">
                                            <div
                                                class="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
                                                :style="{ width: `${entry.progress * 100}%` }"
                                            />
                                        </div>
                                    </div>

                                    <UButton
                                        block
                                        size="xs"
                                        color="neutral"
                                        variant="soft"
                                        icon="i-lucide-undo-2"
                                        label="Recall everyone"
                                        @click="recallNode(node!.id)"
                                    />
                                    <p class="text-[11px] text-muted">
                                        Switches the seam off and sends everyone home to unload what they are carrying.
                                    </p>
                                </div>

                                <div v-if="capacityCost" class="rounded-lg border border-default/60 p-3">
                                    <div class="mb-2 flex items-center justify-between text-xs">
                                        <span class="text-muted">Widen to {{ capacityLevel + 1 + (bonuses?.nodeCapacity ?? 0) }}</span>
                                        <CoinBalance :value="capacityCost.coins" :danger="balance < capacityCost.coins" class="text-xs" />
                                    </div>
                                    <CaravanResource
                                        v-for="(count, id) in capacityCost.resources"
                                        :key="id"
                                        :id="id"
                                        :amount="count"
                                        :have="state?.resources[id] ?? 0"
                                        class="flex w-full justify-between"
                                    />
                                    <UButton
                                        class="mt-2"
                                        block
                                        size="sm"
                                        icon="i-lucide-move-horizontal"
                                        :label="(state?.tier ?? 1) < capacityCost.tier ? `Requires tier ${capacityCost.tier}` : 'Widen the seam'"
                                        :disabled="!canWiden"
                                        @click="upgradeCapacity(node!.id)"
                                    />
                                </div>
                                <p v-else class="text-xs text-muted">This seam is as wide as it goes.</p>
                            </div>

                            <div v-if="nodeCategory" class="flex items-center gap-2 rounded-lg bg-default/40 px-3 py-2 text-xs">
                                <UIcon
                                    :name="CATEGORY_ICONS[nodeCategory]"
                                    class="size-4"
                                    :style="{ color: CATEGORY_COLORS[nodeCategory] }"
                                />
                                <span class="text-muted">
                                    {{ CATEGORY_NAMES[nodeCategory] }} work ·
                                    <span class="text-default">{{ specialistCount }}</span> of your workers specialise in it
                                </span>
                            </div>
                        </div>

                        <!-- Roads -->
                        <div v-if="roads.length" class="space-y-2">
                            <div class="text-xs font-medium uppercase tracking-wide text-muted">Roads</div>
                            <div
                                v-for="road in roads"
                                :key="road.edge.id"
                                class="rounded-lg border border-default/60 px-3 py-2"
                            >
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0">
                                        <div class="truncate text-sm">{{ road.other.name }}</div>
                                        <div class="text-xs text-muted">
                                            {{ ROAD_NAMES[road.level] }} ·
                                            <span class="text-success">×{{ road.current.toFixed(2) }}</span>
                                            <template v-if="road.level < MAX_ROAD_LEVEL"> → ×{{ road.next.toFixed(2) }}</template>
                                        </div>
                                    </div>
                                    <UBadge v-if="!road.linked" size="sm" color="neutral" variant="subtle" label="Unlinked" />
                                    <UBadge v-else-if="road.level >= MAX_ROAD_LEVEL" size="sm" color="success" variant="subtle" label="Causeway" />
                                </div>

                                <div
                                    v-if="road.linked && road.level < MAX_ROAD_LEVEL"
                                    class="mt-2 space-y-1.5 border-t border-default/40 pt-2"
                                >
                                    <div class="flex items-center justify-between text-xs">
                                        <span class="text-muted">Build {{ ROAD_NAMES[road.level + 1] }}</span>
                                        <CoinBalance :value="road.cost" :danger="balance < road.cost" class="text-xs" />
                                    </div>
                                    <CaravanResource
                                        v-for="(count, id) in road.resources"
                                        :key="id"
                                        :id="id"
                                        :amount="count"
                                        :have="state?.resources[id] ?? 0"
                                        class="flex w-full justify-between"
                                    />
                                    <UButton
                                        block
                                        size="xs"
                                        icon="i-lucide-hard-hat"
                                        :label="(state?.tier ?? 1) < road.requiredTier ? `Requires tier ${road.requiredTier}` : 'Build'"
                                        :disabled="!road.affordable || (state?.tier ?? 1) < road.requiredTier"
                                        @click="upgradeRoad(road.edge.id)"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </USlideover>
    </div>
</template>
