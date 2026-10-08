// Polytown client state. One useFetch of /api/town/state is the single source
// of truth; every action POSTs then refreshes it. Build timers count down on
// the client from `serverOffsetMs`, and the state refetches the moment the
// earliest build completes so finished buildings appear without polling hard.
//
// The neighbours' towns come from /api/town/world, fetched only once the state
// is in so your own town is on screen first. They are most of the bytes and
// change slowly, so they refresh on a slower clock than the state, and right
// after any plot action that changes who owns what.

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
     * town's mood and monuments. Never recompute these on the client.
     */
    jobMs: number | null
    nextUpgradeMs: number | null
    /** How well this workshop's inputs reach it over the roads, and from where. */
    supply: {
        ratio: number
        inputs: { resource: string, ratio: number, nearestTiles: number | null, suppliers: number }[]
        /** The individual deliveries behind that ratio, nearest first — what the map draws. */
        links: { producerId: string, resource: string, tiles: number, efficiency: number, sent: number }[]
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

export interface TownWorldView {
    towns: TownNeighbourPlot[]
    listings: { plotId: string, x: number, y: number, ownerName: string, price: number }[]
}

/** How often the neighbours' towns are refetched while the tab is visible. */
const WORLD_REFRESH_MS = 90_000

export interface TownCatalogEntry {
    id: string
    name: string
    emoji: string
    color: number
    tier: number
    kind: 'road' | 'housing' | 'civic' | 'storage' | 'industry' | 'monument'
    description: string
    cost: { coins: number, resources: Record<string, number> }
    buildMs: number
    upgradeMs: number
    workers: number
    inputs: Record<string, number>
    outputs: Record<string, number>
    popCap: number
    happiness: number
    happinessPerLevel?: number
    storage: number
    levelCost: { coins: number, resources: Record<string, number> }
    levelBuildMs: number
    maxLevel: number
    /** The most of this building a town may own; unset means no limit. */
    maxCount?: number
    /** Tiles per side of its square footprint; unset means one. */
    size?: number
}

export interface TownResourceView {
    id: string
    name: string
    emoji: string
    tier: number
    floorPrice: number
    ceilingPrice: number
    /** False for jewels: the bulk-sell buttons skip them unless asked to include them. */
    soldByDefault: boolean
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
    /** Chain this goal belongs to — the same goal at a rising target — or null for a one-off. */
    chain: string | null
    /** 1-based position within `chain`, null outside a chain. */
    step: number | null
    /** Total steps in `chain`, null outside a chain. */
    steps: number | null
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

export interface TownBuildersView {
    owned: number
    busy: number
    nextGemCost: number | null
    /** Owned crews plus the borrowed one while it is here: what `busy` is measured against. */
    total: number
    /** When the borrowed crew leaves (epoch ms), null without one. */
    tempBuilderUntil: number | null
}

/** The timed boosts as the HUD shows them: one entry per kind that is running. */
export type TownBoostKind = 'build' | 'production' | 'market' | 'builder'

export interface TownActiveBoosts {
    /** Builder's rush: build jobs run at double speed until then. */
    build: number | null
    /** Production surge: workshops make (and use) twice as much until then. */
    production: number | null
    /** Market day: the town hall pays 1.5× until then, up to the bonus budget. */
    market: number | null
    /** Free builder: a borrowed crew, here until then. */
    builder: number | null
}

/**
 * Build work left on a job, in ms of normal time. While a Builder's rush runs
 * every real ms inside it does two ms of work, so the remaining real time
 * alone overstates how far along a rushed job is.
 */
export function townJobWorkLeft(completesAt: number, now: number, buildBoostUntil: number | null | undefined): number {
    const left = Math.max(0, completesAt - now)
    if (!buildBoostUntil || buildBoostUntil <= now) return left
    const inside = Math.min(left, buildBoostUntil - now)
    return left + inside
}

/** How far along a job is, 0..1, given the server's full length for it. */
export function townJobProgress(completesAt: number, jobMs: number | null | undefined, now: number, buildBoostUntil: number | null | undefined): number {
    return Math.min(1, Math.max(0, 1 - townJobWorkLeft(completesAt, now, buildBoostUntil) / Math.max(1, jobMs ?? 1)))
}

/** How long a job of `lengthMs` started now would take, with the rush running until `buildBoostUntil`. */
export function townBoostedJobMs(lengthMs: number, now: number, buildBoostUntil: number | null | undefined): number {
    const boostMs = Math.max(0, (buildBoostUntil ?? 0) - now)
    if (lengthMs <= 0 || boostMs <= 0) return lengthMs
    return lengthMs <= 2 * boostMs ? Math.round(lengthMs / 2) : lengthMs - boostMs
}

export interface TownState {
    initialized: boolean
    serverNow: number
    catalog: TownCatalogEntry[]
    resources: TownResourceView[]
    constants: { tickMs: number, maxOfflineMs: number, maxLevel: number, maxPlots: number, rushMsPerGem: number, parkRadius: number, houseCheerMax: number, supplyFullTiles: number, supplyFalloffTiles: number, supplyMinEfficiency: number, maxBuilders: number, jewelsPerGem: number, gemMineCap: number }
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
        monuments: number
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
    plotRefundShare?: number
    builders?: TownBuildersView
    /** When each timed boost ends (epoch ms), null while it is off. */
    boosts?: { build: number | null, production: number | null, market: number | null }
    /** What to scale the base rates by while a boost runs. The rates in here are always the base ones. */
    boostMultiplier?: { build: 1 | 2, production: 1 | 2, market: 1 | 1.5 }
    /** Market-day bonus coins the town hall can still pay out; 0 while it is off. */
    marketBonusLeft?: number
    /** The building the monument crew is raising right now, if any. */
    monumentJob?: string | null
    monumentBonus?: { output: number, supplyTiles: number, buildTime: number, popPerHouseLevel: number, happiness: number, storage: number }
    /** Monument stages carried over from research, by monument id. */
    monumentCredit?: Record<string, number>
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

    // ── Timed boosts ──
    // Bumped the moment a boost runs out, so everything reading `boosts` drops
    // it at once; the refresh after it brings the server's rates back in line.
    const boostTick = ref(0)
    const boosts = computed<TownActiveBoosts>(() => {
        void boostTick.value
        const now = serverNow()
        const b = state.value?.boosts
        const on = (until: number | null | undefined) => until && until > now ? until : null
        return {
            build: on(b?.build),
            production: on(b?.production),
            market: on(b?.market),
            builder: on(state.value?.builders?.tempBuilderUntil)
        }
    })
    /** What the base rates scale by right now. */
    const boostMultiplier = computed(() => ({
        build: boosts.value.build ? 2 : 1,
        production: boosts.value.production ? 2 : 1,
        market: boosts.value.market ? 1.5 : 1
    }))
    /** Market-day bonus coins left, 0 once the day or the budget is spent. */
    const marketBonusLeft = computed(() => boosts.value.market ? Math.max(0, state.value?.marketBonusLeft ?? 0) : 0)

    let boostTimer: ReturnType<typeof setTimeout> | null = null
    function scheduleBoostExpiry() {
        if (boostTimer) clearTimeout(boostTimer)
        boostTimer = null
        if (!import.meta.client) return
        const now = serverNow()
        const b = state.value?.boosts
        const ends = [b?.build, b?.production, b?.market, state.value?.builders?.tempBuilderUntil]
            .filter((t): t is number => typeof t === 'number' && t > now)
        if (!ends.length) return
        const next = Math.min(...ends)
        // setTimeout overflows past ~24.8 days; nothing runs that long, but stay safe.
        boostTimer = setTimeout(() => {
            boostTimer = null
            boostTick.value++
            refresh()
        }, Math.min(2 ** 31 - 1, next - now + 50))
    }
    watch(() => [state.value?.boosts, state.value?.builders?.tempBuilderUntil], scheduleBoostExpiry, { immediate: true })

    const initialized = computed(() => state.value?.initialized ?? false)
    const catalog = computed(() => state.value?.catalog ?? [])
    const resources = computed(() => state.value?.resources ?? [])
    const buildings = computed(() => state.value?.buildings ?? [])
    const plots = computed(() => state.value?.plots ?? [])
    const inventory = computed(() => state.value?.inventory ?? {})
    const myOrders = computed(() => state.value?.myOrders ?? [])
    const lastPrices = computed(() => state.value?.lastPrices ?? {})
    const constants = computed(() => state.value?.constants ?? { tickMs: 60_000, maxOfflineMs: 8 * 3_600_000, maxLevel: 20, maxPlots: 12, rushMsPerGem: 300_000, parkRadius: 4, houseCheerMax: 48, supplyFullTiles: 8, supplyFalloffTiles: 24, supplyMinEfficiency: 0.3, maxBuilders: 6, jewelsPerGem: 10, gemMineCap: 2 })
    const milestones = computed(() => state.value?.milestones ?? [])
    /** Build crews: how many the town owns, how many are on a job, what the next costs. */
    const builders = computed<TownBuildersView>(() => {
        const b = state.value?.builders
        if (!b) return { owned: 3, busy: 0, nextGemCost: null, total: 3, tempBuilderUntil: null }
        // The borrowed crew leaves on the client's clock, before the refresh lands.
        const temp = boosts.value.builder
        return { ...b, total: temp ? b.total : Math.min(b.total, b.owned), tempBuilderUntil: temp }
    })
    /** The monument crew's one job: the id of the monument going up, or null while it is free. */
    const monumentJob = computed(() => state.value?.monumentJob ?? null)
    /** Stages carried over from research: placing that monument puts it up at this stage, free. */
    const monumentCredit = computed(() => state.value?.monumentCredit ?? {})
    const buildersFree = computed(() => Math.max(0, builders.value.total - builders.value.busy))
    const claimableMilestones = computed(() => milestones.value.filter(m => m.complete && !m.claimed))
    const unlockedTiers = computed(() => new Set(state.value?.unlockedTiers ?? [0, 1]))
    const netPerTick = computed(() => state.value?.netPerTick ?? {})
    const needs = computed(() => state.value?.needs ?? [])
    /** Other mayors' plots around you; empty until the first world fetch lands. */
    const worldData = shallowRef<TownWorldView | null>(null)
    const world = computed<TownWorldView>(() => worldData.value ?? { towns: [], listings: [] })
    const worldLoaded = computed(() => worldData.value !== null)
    const countsByType = computed(() => state.value?.countsByType ?? {})
    const nextCost = computed(() => state.value?.nextCost ?? {})
    const tierLocks = computed(() => state.value?.tierLocks ?? {})

    const catalogById = computed(() => new Map(catalog.value.map(c => [c.id, c])))
    const resourceById = computed(() => new Map(resources.value.map(r => [r.id, r])))

    function serverNow() {
        return Date.now() + serverOffsetMs.value
    }

    /**
     * Net units per tick with a production surge counted in. A surge doubles
     * what the workshops make and use, never what the townsfolk eat, so the
     * needs come off the base net, the rest doubles, and they go back on.
     */
    const boostedNetPerTick = computed<Record<string, number>>(() => {
        const net = state.value?.netPerTick ?? {}
        const m = boostMultiplier.value.production
        if (m === 1) return net
        const eaten: Record<string, number> = {}
        for (const n of state.value?.needs ?? []) {
            if (n.active) eaten[n.resource] = (eaten[n.resource] ?? 0) + n.perTick
        }
        const out: Record<string, number> = {}
        for (const id of new Set([...Object.keys(net), ...Object.keys(eaten)])) {
            const e = eaten[id] ?? 0
            out[id] = ((net[id] ?? 0) + e) * m - e
        }
        return out
    })

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

    // One world fetch at a time. A call that arrives while one is in flight
    // (a plot bought mid-refresh) asks for another pass, because the response
    // already on its way may predate the change.
    let worldInflight: Promise<void> | null = null
    let worldAgain = false
    let worldFetchedAt = 0
    function refreshWorld(): Promise<void> {
        if (worldInflight) {
            worldAgain = true
            return worldInflight
        }
        worldInflight = (async () => {
            try {
                do {
                    worldAgain = false
                    worldFetchedAt = Date.now()
                    worldData.value = await $fetch<TownWorldView>('/api/town/world' as string)
                } while (worldAgain)
            } catch {
                // Scenery only: keep what is drawn and try again on the next
                // tick, not after a full refresh interval.
                worldFetchedAt = 0
            } finally {
                worldInflight = null
            }
        })()
        return worldInflight
    }

    // The world waits for the town: it starts loading once the state is in.
    watch(initialized, (ready) => {
        if (ready && !worldData.value) refreshWorld()
    }, { immediate: true })

    // Background settle so inventory keeps ticking up while the tab is open.
    let pollTimer: ReturnType<typeof setInterval> | null = null
    onMounted(() => {
        pollTimer = setInterval(() => {
            if (document.visibilityState !== 'visible') return
            refresh()
            if (initialized.value && Date.now() - worldFetchedAt >= WORLD_REFRESH_MS) refreshWorld()
        }, 30_000)
    })
    onBeforeUnmount(() => {
        if (pollTimer) clearInterval(pollTimer)
        if (completionTimer) clearTimeout(completionTimer)
        if (boostTimer) clearTimeout(boostTimer)
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

    /** A plot changed hands or went on the market: the map around you changed too. */
    async function landCall<T = unknown>(url: string, body: Record<string, unknown> = {}): Promise<T> {
        const res = await call<T>(url, body)
        refreshWorld()
        return res
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
        monumentJob,
        monumentCredit,
        buildersFree,
        claimableMilestones,
        unlockedTiers,
        netPerTick,
        boostedNetPerTick,
        boosts,
        boostMultiplier,
        marketBonusLeft,
        needs,
        world,
        worldLoaded,
        refreshWorld,
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
        /** The whole town laid out again: every kept building's new tile, plus roads to lay fresh. Roads left out are removed. */
        redesign: (moves: { buildingId: string, plotId: string, tileX: number, tileY: number, rotation: number }[], roads: { plotId: string, tileX: number, tileY: number }[]) =>
            call<{ moved: string[], removed: string[], built: string[], coins: number }>('/api/town/redesign', { moves, roads }),
        demolishBuildings: (buildingIds: string[]) =>
            call<{ demolished: string[], types: string[] }>('/api/town/building/demolish-bulk', { buildingIds }),
        upgradeBuildings: (buildingIds: string[]) =>
            call<{ started: { buildingId: string, level: number }[], skipped: number, reason: string | null }>('/api/town/building/upgrade-bulk', { buildingIds }),
        sellBulk: (items: { resource: string, quantity: number }[]) =>
            call<{ total: number, lines: { resource: string, quantity: number, total: number }[], resources: string[], marketBonus: number }>('/api/town/market/sell-bulk', { items }),
        upgradeBuilding: (buildingId: string) => call<{ level: number, completesAt: number }>('/api/town/building/upgrade', { buildingId }),
        rushBuilding: (buildingId: string) => call<{ gems: number, level: number }>('/api/town/building/rush', { buildingId }),
        demolishBuilding: (buildingId: string) => call('/api/town/building/demolish', { buildingId }),
        listPlot: (plotId: string, price: number | null) => landCall<{ plotId: string, listPrice: number | null }>('/api/town/plot/list', { plotId, price }),
        sellPlot: (plotId: string) => landCall<{ plotId: string, refund: number }>('/api/town/plot/sell', { plotId }),
        buyPlotFromPlayer: (plotId: string, expectedPrice: number) => landCall<{ plotId: string, price: number }>('/api/town/plot/buy-from-player', { plotId, expectedPrice }),
        buyPlot: (x: number, y: number) => landCall<{ plotId: string, price: number }>('/api/town/plot/buy', { x, y }),
        hireBuilder: () => call<{ builders: number, gems: number }>('/api/town/builder'),
        sellToFloor: (resource: string, quantity: number) =>
            call<{ total: number, quantity: number, toPlayers: number, toHall: number, filledByPlayers: number, marketBonus: number }>('/api/town/market/sell-floor', { resource, quantity }),
        convertJewels: (gems: number) => call<{ gems: number, jewels: number }>('/api/town/market/convert', { gems }),
        placeOrder: (resource: string, side: 'buy' | 'sell', price: number, quantity: number) =>
            call<{ status: 'open' | 'filled', filled: number, coinsMoved: number }>('/api/town/market/place', { resource, side, price, quantity }),
        cancelOrder: (orderId: string) => call('/api/town/market/cancel', { orderId })
    }
}
