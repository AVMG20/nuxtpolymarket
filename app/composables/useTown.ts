// Polytown client state. One useFetch of /api/town/state is the single source
// of truth; every action POSTs then refreshes it. Build timers count down on
// the client from `serverOffsetMs`, and the state refetches the moment the
// earliest build completes so finished buildings appear without polling hard.

export interface TownBuildingView {
    id: string
    plotId: string
    type: string
    tileX: number
    tileY: number
    rotation: number
    level: number
    upgradingTo: number | null
    completesAt: number
    createdAt: number
    staffing: number | null
    connected: boolean
    /** The road network it is on: residents living along it and posts to fill. Null while cut off. */
    district: { residents: number, jobs: number, employed: number } | null
    /**
     * Durations quoted by the server, which is the only place that knows this
     * town's mood and research. Never recompute these on the client.
     */
    jobMs: number | null
    nextUpgradeMs: number | null
    /** How well this workshop's inputs reach it over the roads, and from where. */
    supply: {
        ratio: number
        inputs: { resource: string, ratio: number, nearestTiles: number | null, suppliers: number }[]
    } | null
    /** What it actually runs at: staffing × supply. */
    throughput: number | null
}

export interface TownPlotView {
    id: string
    x: number
    y: number
    /** Asking price while this plot is on the player market. */
    listPrice: number | null
    /** What the land office would pay to take it back. */
    refund: number
}

export interface TownNeighbourPlot {
    id: string
    x: number
    y: number
    ownerId: string
    ownerName: string
    listPrice: number | null
    /** Their buildings, sites included: level 0 is going up, upgradingTo is growing. */
    buildings: { type: string, tileX: number, tileY: number, rotation: number, level: number, upgradingTo: number | null, completesAt: number }[]
}

export interface TownCatalogEntry {
    id: string
    name: string
    emoji: string
    color: number
    tier: number
    kind: 'road' | 'housing' | 'civic' | 'storage' | 'industry'
    description: string
    cost: { coins: number, resources: Record<string, number> }
    buildMs: number
    upgradeMs: number
    workers: number
    inputs: Record<string, number>
    outputs: Record<string, number>
    popCap: number
    happiness: number
    storage: number
    levelCost: { coins: number, resources: Record<string, number> }
    levelBuildMs: number
    maxLevel: number
}

export interface TownResourceView {
    id: string
    name: string
    emoji: string
    tier: number
    floorPrice: number
    ceilingPrice: number
}

export interface TownOrderView {
    id: string
    resource: string
    side: 'buy' | 'sell'
    price: number
    quantity: number
    filled: number
    createdAt: number
}

export interface TownMilestoneView {
    id: string
    title: string
    description: string
    emoji: string
    reward: number
    gems: number
    tier: number
    current: number
    target: number
    complete: boolean
    claimed: boolean
}

export interface TownNeedView {
    resource: string
    name: string
    description: string
    perTick: number
    minPop: number
    active: boolean
    happiness: number
    food: boolean
    satisfied: boolean
    stock: number
    resourceTier: number
    expected: boolean
    producible: boolean
}

export interface TownMoodView {
    id: string
    name: string
    emoji: string
    speed: number
    buildTime: number
    storage: number
}

export interface TownResearchProject {
    id: string
    branch: string
    step: number
    name: string
    description: string
    durationMs: number
    coins: number
    resources: Record<string, number>
    done: boolean
    unlocked: boolean
}

export interface TownResearchBoard {
    active: { researchId: string, completesAt: number } | null
    done: string[]
    projects: TownResearchProject[]
}

export interface TownState {
    initialized: boolean
    serverNow: number
    catalog: TownCatalogEntry[]
    resources: TownResourceView[]
    constants: { tickMs: number, maxOfflineMs: number, maxLevel: number, maxPlots: number, rushMsPerGem: number, parkRadius: number, parkMaxBonus: number, industryMaxPenalty: number, supplyFullTiles: number, supplyFalloffTiles: number, supplyMinEfficiency: number, maxBuilders: number }
    netPerTick?: Record<string, number>
    unlockedTiers?: number[]
    coinsEarned?: number
    milestones?: TownMilestoneView[]
    welcomeBack?: { elapsedMs: number, delta: Record<string, number> } | null
    happiness?: number
    happinessTarget?: number
    speedMultiplier?: number
    popCap?: number
    workersDemanded?: number
    workersEmployed?: number
    storageCap?: number
    needs?: TownNeedView[]
    happinessPotential?: number
    reachableTier?: number
    happinessBreakdown?: {
        base: number
        needs: number
        parks: number
        industry: number
        crowding: number
        layout: { parks: number, industry: number, residents: number, residentsWithPark: number, residentsWithIndustry: number }
    }
    mood?: TownMoodView
    nextMood?: (TownMoodView & { min: number }) | null
    countsByType?: Record<string, number>
    nextCost?: Record<string, { coins: number, resources: Record<string, number> }>
    tierLocks?: Record<string, { needsBuilding: boolean, pop: number, popRequired: number, produced: number, producedRequired: number, producedTier: number } | null>
    produced?: Record<string, number>
    floorIncomePerDay?: number
    tickProgressMs?: number
    lastSettledAt?: number
    plots?: TownPlotView[]
    plotPurchase?: { nextIndex: number, price: number, cooldownMs: number, availableAt: number, remainingMs: number, maxed: boolean }
    expansions?: { x: number, y: number, free: boolean, ownerName?: string }[]
    world?: { towns: TownNeighbourPlot[], listings: { plotId: string, x: number, y: number, ownerName: string, price: number }[] }
    plotRefundShare?: number
    builders?: { owned: number, busy: number, nextGemCost: number | null }
    buildings?: TownBuildingView[]
    inventory?: Record<string, number>
    myOrders?: TownOrderView[]
    lastPrices?: Record<string, number>
}

export const useTown = () => {
    const toast = useToast()
    const { fetchSession } = useAuth()

    const { data: state, refresh, pending } = useAsyncData<TownState | null>(
        'town-state',
        () => $fetch<TownState>('/api/town/state' as string),
        { server: false, default: () => null }
    )

    const serverOffsetMs = ref(0)
    watch(state, (s) => {
        if (s?.serverNow) serverOffsetMs.value = s.serverNow - Date.now()
    }, { immediate: true })

    const initialized = computed(() => state.value?.initialized ?? false)
    const catalog = computed(() => state.value?.catalog ?? [])
    const resources = computed(() => state.value?.resources ?? [])
    const buildings = computed(() => state.value?.buildings ?? [])
    const plots = computed(() => state.value?.plots ?? [])
    const inventory = computed(() => state.value?.inventory ?? {})
    const myOrders = computed(() => state.value?.myOrders ?? [])
    const lastPrices = computed(() => state.value?.lastPrices ?? {})
    const constants = computed(() => state.value?.constants ?? { tickMs: 60_000, maxOfflineMs: 8 * 3_600_000, maxLevel: 20, maxPlots: 12, rushMsPerGem: 300_000, parkRadius: 3, parkMaxBonus: 20, industryMaxPenalty: 25, supplyFullTiles: 8, supplyFalloffTiles: 24, supplyMinEfficiency: 0.3, maxBuilders: 6 })
    const milestones = computed(() => state.value?.milestones ?? [])
    /** Build crews: how many the town owns, how many are on a job, what the next costs. */
    const builders = computed(() => state.value?.builders ?? { owned: 3, busy: 0, nextGemCost: null })

    // Research is its own endpoint: the board is long and changes rarely, so it
    // has no business being refetched with every settle. It is still fetched
    // once on load, because the dock shows a dot while a project is running and
    // that has to be right before anybody opens the window.
    const { data: researchBoard, refresh: refreshResearch } = useAsyncData<TownResearchBoard | null>(
        'town-research',
        () => $fetch<TownResearchBoard>('/api/town/research' as string),
        { server: false, default: () => null }
    )
    const buildersFree = computed(() => Math.max(0, builders.value.owned - builders.value.busy))
    const claimableMilestones = computed(() => milestones.value.filter(m => m.complete && !m.claimed))
    const unlockedTiers = computed(() => new Set(state.value?.unlockedTiers ?? [0, 1]))
    const netPerTick = computed(() => state.value?.netPerTick ?? {})
    const needs = computed(() => state.value?.needs ?? [])
    const world = computed(() => state.value?.world ?? { towns: [], listings: [] })
    const countsByType = computed(() => state.value?.countsByType ?? {})
    const nextCost = computed(() => state.value?.nextCost ?? {})
    const tierLocks = computed(() => state.value?.tierLocks ?? {})

    const catalogById = computed(() => new Map(catalog.value.map(c => [c.id, c])))
    const resourceById = computed(() => new Map(resources.value.map(r => [r.id, r])))

    function serverNow() {
        return Date.now() + serverOffsetMs.value
    }

    // Refetch right after the earliest pending build finishes (+ a little slack
    // so the server-side settle sees it as done).
    let completionTimer: ReturnType<typeof setTimeout> | null = null
    watch(buildings, (list) => {
        if (completionTimer) clearTimeout(completionTimer)
        completionTimer = null
        const now = serverNow()
        const pendingList = list.filter(b => b.completesAt > now)
        if (pendingList.length === 0) return
        const next = Math.min(...pendingList.map(b => b.completesAt))
        completionTimer = setTimeout(() => { refresh() }, Math.max(500, next - now + 400))
    }, { immediate: true })

    // Background settle so inventory keeps ticking up while the tab is open.
    let pollTimer: ReturnType<typeof setInterval> | null = null
    onMounted(() => {
        pollTimer = setInterval(() => {
            if (document.visibilityState === 'visible') refresh()
        }, 30_000)
    })
    onBeforeUnmount(() => {
        if (pollTimer) clearInterval(pollTimer)
        if (completionTimer) clearTimeout(completionTimer)
    })

    async function call<T = unknown>(url: string, body: Record<string, unknown> = {}): Promise<T> {
        try {
            const res = await $fetch<T>(url, { method: 'POST', body })
            await Promise.all([refresh(), fetchSession()])
            return res
        } catch (e: unknown) {
            const err = e as { data?: { message?: string, statusMessage?: string } }
            toast.add({ title: err?.data?.statusMessage ?? err?.data?.message ?? 'Something went wrong', color: 'error' })
            throw e
        }
    }

    return {
        state,
        pending,
        refresh,
        serverOffsetMs,
        serverNow,
        initialized,
        catalog,
        catalogById,
        resources,
        resourceById,
        buildings,
        plots,
        inventory,
        myOrders,
        lastPrices,
        constants,
        milestones,
        builders,
        researchBoard,
        refreshResearch,
        buildersFree,
        claimableMilestones,
        unlockedTiers,
        netPerTick,
        needs,
        world,
        countsByType,
        nextCost,
        tierLocks,
        foundTown: () => call('/api/town/init'),
        claimMilestone: (id: string) => call<{ id: string, reward: number, gems: number, title: string }>('/api/town/milestone/claim', { id }),
        placeBuilding: (plotId: string, tileX: number, tileY: number, type: string, rotation = 0) =>
            call<{ buildingId: string, completesAt: number }>('/api/town/building/place', { plotId, tileX, tileY, type, rotation }),
        moveBuilding: (buildingId: string, plotId: string, tileX: number, tileY: number, rotation: number) =>
            call<{ buildingId: string }>('/api/town/building/move', { buildingId, plotId, tileX, tileY, rotation }),
        /** A drag: every tile it painted, laid in one transaction. */
        placeBuildings: (items: { plotId: string, tileX: number, tileY: number, type: string, rotation: number }[]) =>
            call<{ placed: { buildingId: string, type: string }[], skipped: number, reason: string | null }>('/api/town/building/place-bulk', { items }),
        /** A whole selection moved together, all or nothing. */
        moveBuildings: (moves: { buildingId: string, plotId: string, tileX: number, tileY: number, rotation: number }[]) =>
            call<{ moved: string[] }>('/api/town/building/move-bulk', { moves }),
        demolishBuildings: (buildingIds: string[]) =>
            call<{ demolished: string[], types: string[] }>('/api/town/building/demolish-bulk', { buildingIds }),
        upgradeBuildings: (buildingIds: string[]) =>
            call<{ started: { buildingId: string, level: number }[], skipped: number, reason: string | null }>('/api/town/building/upgrade-bulk', { buildingIds }),
        sellBulk: (items: { resource: string, quantity: number }[]) =>
            call<{ total: number, lines: { resource: string, quantity: number, total: number }[], resources: string[] }>('/api/town/market/sell-bulk', { items }),
        upgradeBuilding: (buildingId: string) => call<{ level: number, completesAt: number }>('/api/town/building/upgrade', { buildingId }),
        rushBuilding: (buildingId: string) => call<{ gems: number, level: number }>('/api/town/building/rush', { buildingId }),
        demolishBuilding: (buildingId: string) => call('/api/town/building/demolish', { buildingId }),
        listPlot: (plotId: string, price: number | null) => call<{ plotId: string, listPrice: number | null }>('/api/town/plot/list', { plotId, price }),
        sellPlot: (plotId: string) => call<{ plotId: string, refund: number }>('/api/town/plot/sell', { plotId }),
        buyPlotFromPlayer: (plotId: string, expectedPrice: number) => call<{ plotId: string, price: number }>('/api/town/plot/buy-from-player', { plotId, expectedPrice }),
        buyPlot: (x: number, y: number) => call<{ plotId: string, price: number }>('/api/town/plot/buy', { x, y }),
        hireBuilder: () => call<{ builders: number, gems: number }>('/api/town/builder'),
        startResearch: (researchId: string) => call<{ researchId: string, completesAt: number }>('/api/town/research/start', { researchId }),
        sellToFloor: (resource: string, quantity: number) =>
            call<{ total: number, quantity: number, toPlayers: number, toHall: number, filledByPlayers: number }>('/api/town/market/sell-floor', { resource, quantity }),
        placeOrder: (resource: string, side: 'buy' | 'sell', price: number, quantity: number) =>
            call<{ status: 'open' | 'filled', filled: number, coinsMoved: number }>('/api/town/market/place', { resource, side, price, quantity }),
        cancelOrder: (orderId: string) => call('/api/town/market/cancel', { orderId })
    }
}
