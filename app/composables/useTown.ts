// Polytown client state. One fetch of /api/town/state is the single source of
// truth. Actions whose outcome the client already knows (building, moving,
// storing, upgrading, clearing) change the state here first and refetch once
// every request in flight has landed; see `optimistic`. Build timers count
// down on the client from `serverOffsetMs`, and the state refetches the moment
// the earliest build completes so finished buildings appear without polling hard.
//
// The neighbours' towns come from /api/town/world, fetched only once the state
// is in so your own town is on screen first. They are most of the bytes and
// change slowly, so they refresh on a slower clock than the state, and right
// after any plot action that changes who owns what.

import { TOWN_BUILDINGS, TOWN_PLOT_SIZE, getTownBuilding, townBuildersBusy, townBuildingCountIssue, townBuildingMaxLevel, townLevelCost, townMonumentJob, townPlaceCost, townRoadAccess, type TownSimBuilding } from '#shared/utils/gamelogic/town'
import { townStoredIsJob, type TownRedesignDraft } from '#shared/utils/gamelogic/town-storage'
import { townBoostedNet } from '#shared/utils/gamelogic/town-advisor'

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
    /** Buildings taken off the map. */
    storage?: TownStorageView
    /** A redesign saved half-way, or null. */
    redesignDraft?: { draft: TownRedesignDraft, updatedAt: number } | null
    inventory?: Record<string, number>
    myOrders?: TownOrderView[]
    lastPrices?: Record<string, number>
}

/** One building in storage, oldest first. */
export interface TownStoredView {
    id: string
    type: string
    level: number
    upgradingTo: number | null
    /** Build time a paused job still owes. */
    remainingMs: number
    storedAt: number
    createdAt: number
    /** A construction or upgrade waiting for a crew to pick it back up. */
    paused: boolean
}

export interface TownStorageView {
    items: TownStoredView[]
}

/** A building put down somewhere: what a redesign sends for each move and each placement out of storage. */
export interface TownSpot { buildingId: string, plotId: string, tileX: number, tileY: number, rotation: number }

export const useTown = () => {
    const toast = useToast()
    const { fetchSession, setBalance, balanceNum } = useAuth()

    const { data: state, pending } = useAsyncData<TownState | null>(
        'town-state',
        () => $fetch<TownState>('/api/town/state' as string),
        { server: false, default: () => null }
    )

    const serverOffsetMs = ref(0)
    // Keyed on the server's clock, not the state: a local change carries the
    // old reading along, and measuring it against a later Date.now() would drift.
    watch(() => state.value?.serverNow, (at) => {
        if (at) serverOffsetMs.value = at - Date.now()
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
    const storage = computed<TownStorageView>(() => state.value?.storage ?? { items: [] })
    const redesignDraft = computed(() => state.value?.redesignDraft ?? null)
    const nextCost = computed(() => state.value?.nextCost ?? {})
    const tierLocks = computed(() => state.value?.tierLocks ?? {})

    const catalogById = computed(() => new Map(catalog.value.map(c => [c.id, c])))
    const resourceById = computed(() => new Map(resources.value.map(r => [r.id, r])))

    function serverNow() {
        return Date.now() + serverOffsetMs.value
    }

    /** Net units per tick with a production surge counted in (see townBoostedNet). */
    const boostedNetPerTick = computed<Record<string, number>>(() =>
        townBoostedNet(state.value?.netPerTick ?? {}, state.value?.needs ?? [], boostMultiplier.value.production))

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

    // ── Optimistic actions ──
    // A change the client can work out for itself is made to `state` at once,
    // and the request goes out behind it. The town is refetched only once every
    // request in flight has landed, and a refetch that started before a later
    // local change is dropped (`generation`), so a poll or a build timer cannot
    // flicker a fresh placement away. A failed action is undone from its
    // snapshot when nothing changed since, and the refetch after it puts the
    // server's word back either way.
    let inFlight = 0
    let generation = 0
    let fetchSeq = 0
    let appliedSeq = 0
    /**
     * The balance a coin-moving response reported, set once nothing is in
     * flight. Each is read after its own commit, so with several in one burst
     * the last to arrive need not be the newest: then the session is refetched.
     */
    let landedBalance: string | null = null
    let balancesLanded = 0
    let gemsChanged = false
    let settling = 0
    /** Callers waiting for the town to be idle and refetched; see `idle`. */
    let idleWaiters: (() => void)[] = []

    /** Refetch the town. Skipped while an action is in flight: its landing refetches instead. */
    async function refresh(): Promise<void> {
        if (inFlight > 0) return
        const gen = generation
        const seq = ++fetchSeq
        try {
            const fresh = await $fetch<TownState>('/api/town/state' as string)
            if (gen !== generation || inFlight > 0 || seq < appliedSeq) return
            appliedSeq = seq
            state.value = fresh
        } catch {
            // Keep what is drawn; the next poll tries again.
        }
    }

    /** Everything in flight has landed: take the server's balance and town back. */
    async function settle(): Promise<void> {
        settling++
        const sessionStale = gemsChanged || balancesLanded > 1
        if (!sessionStale && landedBalance !== null) setBalance(landedBalance)
        landedBalance = null
        balancesLanded = 0
        gemsChanged = false
        if (sessionStale) fetchSession()
        await refresh()
        settling--
        // Another action may have started meanwhile: its own landing settles again.
        if (inFlight > 0 || settling > 0) return
        const waiters = idleWaiters
        idleWaiters = []
        for (const resolve of waiters) resolve()
    }

    /** Resolves once nothing is in flight and the refetch after the last action has come in. */
    function idle(): Promise<void> {
        if (inFlight === 0 && settling === 0) return Promise.resolve()
        return new Promise(resolve => idleWaiters.push(resolve))
    }

    // Requests aimed at the same building go out one after another, in the
    // order they were made, so a move and then a store (or two moves) cannot
    // reach the server the other way round.
    const buildingQueue = new Map<string, Promise<void>>()
    function inTurn<T>(ids: string[], request: () => Promise<T>): () => Promise<T> {
        const prior = ids.flatMap(id => buildingQueue.get(id) ?? [])
        const turn = Promise.all(prior).then(request)
        const done = turn.then(() => {}, () => {})
        for (const id of ids) buildingQueue.set(id, done)
        done.then(() => {
            for (const id of ids) if (buildingQueue.get(id) === done) buildingQueue.delete(id)
        })
        return () => turn
    }

    function errorToast(e: unknown) {
        const err = e as { data?: { message?: string, statusMessage?: string } }
        toast.add({ title: err?.data?.statusMessage ?? err?.data?.message ?? 'Something went wrong', color: 'error' })
    }

    /**
     * Counts, prices, crews and road access, worked out again after a local
     * change the way the state endpoint works them out. Staffing, supply and
     * the happiness figures stay as they were until the refetch.
     */
    function rederive(s: TownState): TownState {
        const now = serverNow()
        const plotsById = new Map((s.plots ?? []).map(p => [p.id, p]))
        const list = s.buildings ?? []
        const sim: TownSimBuilding[] = list.map((b) => {
            const plot = plotsById.get(b.plotId)
            return {
                id: b.id,
                type: b.type as TownSimBuilding['type'],
                level: b.level,
                completesAt: b.completesAt,
                upgradingTo: b.upgradingTo,
                createdAt: b.createdAt,
                wx: plot ? plot.x * TOWN_PLOT_SIZE + b.tileX : undefined,
                wy: plot ? plot.y * TOWN_PLOT_SIZE + b.tileY : undefined,
                rotation: b.rotation
            }
        })
        // Stored buildings are still owned: they count toward caps and prices.
        const countsByType: Record<string, number> = {}
        for (const b of [...list, ...(s.storage?.items ?? [])]) countsByType[b.type] = (countsByType[b.type] ?? 0) + 1
        const credit = s.monumentCredit ?? {}
        const nextCost = Object.fromEntries(TOWN_BUILDINGS.map(def => [def.id, credit[def.id] ? { coins: 0, resources: {} } : townPlaceCost(def, countsByType[def.id] ?? 0)]))
        return {
            ...s,
            countsByType,
            nextCost,
            builders: s.builders ? { ...s.builders, busy: townBuildersBusy(sim, now) } : s.builders,
            monumentJob: townMonumentJob(sim, now)?.id ?? null,
            buildings: list.map((b, i) => {
                const connected = townRoadAccess(sim, sim[i]!)
                return connected === b.connected ? b : { ...b, connected }
            })
        }
    }

    /** Swap in a locally changed town. */
    function mutate(change: (s: TownState) => TownState) {
        if (!state.value) return
        state.value = rederive(change(state.value))
        generation++
    }

    interface ActionOptions<T> {
        /** Coins the change spends, known exactly: off the balance at once, back on a failure. */
        coins?: number
        /** Gems change hands: the session is refetched once everything has landed. */
        gems?: boolean
        /** Land changed hands: the neighbours are refetched too. */
        world?: boolean
        /** Resolve only once the refetched town is in, for callers that swap views on success. */
        awaitState?: boolean
        /** Fold the server's answer in (real ids, exact timers) before the refetch. */
        landed?: (res: T) => void
        failed?: () => void
    }

    async function optimistic<T>(change: ((s: TownState) => TownState) | null, request: () => Promise<T>, opts: ActionOptions<T> = {}): Promise<T> {
        const before = state.value
        if (change) mutate(change)
        const mine = generation
        if (opts.coins) setBalance(balanceNum.value - opts.coins)
        inFlight++
        let res: T
        try {
            res = await request()
            const balance = (res as { balance?: unknown } | null)?.balance
            if (typeof balance === 'string' || typeof balance === 'number') {
                landedBalance = String(balance)
                balancesLanded++
            }
            opts.landed?.(res)
        } catch (e) {
            // Undo: straight back to the snapshot when nothing else changed the
            // town since; otherwise the refetch below sorts it out.
            if (change && before && generation === mine) state.value = before
            if (opts.coins) setBalance(balanceNum.value + opts.coins)
            opts.failed?.()
            errorToast(e)
            throw e
        } finally {
            inFlight--
            if (opts.gems) gemsChanged = true
            if (opts.world) refreshWorld()
            if (inFlight === 0) settle()
        }
        if (opts.awaitState) await idle()
        return res
    }

    function post<T>(url: string, body: Record<string, unknown> = {}): Promise<T> {
        return $fetch<T>(url, { method: 'POST', body })
    }

    // A placement is drawn under a temporary id until the server names it.
    // Anything aimed at it meanwhile waits for the real id; a placement that
    // failed resolves to null and drops out.
    let tempSeq = 0
    const tempIds = new Map<string, Promise<string | null>>()
    async function realIds(ids: string[]): Promise<string[]> {
        const list = await Promise.all(ids.map(id => tempIds.get(id) ?? id))
        return list.filter((id): id is string => !!id)
    }
    async function realSpots<S extends { buildingId: string }>(spots: S[]): Promise<S[]> {
        const ids = await Promise.all(spots.map(s => tempIds.get(s.buildingId) ?? s.buildingId))
        return spots.flatMap((s, i) => ids[i] ? [{ ...s, buildingId: ids[i]! }] : [])
    }

    /** What the town can still pay for, spent down as one action works through its list. */
    function purse() {
        let coins = balanceNum.value
        const goods: Record<string, number> = { ...inventory.value }
        return {
            affords: (cost: { coins: number, resources: Record<string, number> }) =>
                coins >= cost.coins && Object.entries(cost.resources).every(([id, q]) => (goods[id] ?? 0) >= q),
            spend(cost: { coins: number, resources: Record<string, number> }) {
                coins -= cost.coins
                for (const [id, q] of Object.entries(cost.resources)) goods[id] = (goods[id] ?? 0) - q
            }
        }
    }

    function addGoods(inv: Record<string, number> | undefined, bag: Record<string, number>, sign: 1 | -1) {
        const out = { ...(inv ?? {}) }
        for (const [id, q] of Object.entries(bag)) out[id] = (out[id] ?? 0) + sign * q
        return out
    }

    /** A job whose clock ran out, shown as finished; the server settles it the same way. */
    function finished(b: TownBuildingView, now: number): TownBuildingView {
        return b.completesAt <= now && (b.level === 0 || b.upgradingTo !== null) ? { ...b, level: b.upgradingTo ?? 1, upgradingTo: null } : b
    }
    function jobRunning(b: TownBuildingView, now: number) {
        return b.completesAt > now && (b.level === 0 || b.upgradingTo !== null)
    }

    const siteKey = (s: { plotId: string, tileX: number, tileY: number }) => `${s.plotId}:${s.tileX}:${s.tileY}`

    type Placement = { plotId: string, tileX: number, tileY: number, type: string, rotation: number }
    type PlacedSite = { buildingId: string, type: string, plotId: string, tileX: number, tileY: number, completesAt: number }
    type PlaceResult = { placed: PlacedSite[], skipped: number, reason: string | null }

    /** The sites a placement puts up, checked the way the server checks them (crews, caps, purse), and what they cost. */
    function planPlacements(items: Placement[]) {
        const s = state.value
        const now = serverNow()
        const counts = { ...countsByType.value }
        const credit = monumentCredit.value
        const wallet = purse()
        let crews = buildersFree.value
        let monumentCrew = monumentJob.value === null
        const sites: TownBuildingView[] = []
        const usedCredit: string[] = []
        const goods: Record<string, number> = {}
        let coins = 0
        for (const item of items) {
            const def = getTownBuilding(item.type)
            if (!def || townBuildingCountIssue(def, counts[def.id] ?? 0)) continue
            const road = def.kind === 'road'
            const monument = def.kind === 'monument'
            // Research credit puts a monument up at once, at its stage, for free.
            const stage = monument && !usedCredit.includes(def.id) ? Math.max(0, Math.floor(credit[def.id] ?? 0)) : 0
            if (monument && !stage && !monumentCrew) continue
            if (!road && !monument && crews <= 0) continue
            const cost = stage > 0 ? { coins: 0, resources: {} } : townPlaceCost(def, counts[def.id] ?? 0)
            if (!wallet.affords(cost)) continue
            wallet.spend(cost)
            coins += cost.coins
            for (const [id, q] of Object.entries(cost.resources)) goods[id] = (goods[id] ?? 0) + q
            counts[def.id] = (counts[def.id] ?? 0) + 1
            if (stage > 0) usedCredit.push(def.id)
            else if (monument) monumentCrew = false
            else if (!road) crews--
            const instant = road || stage > 0
            // The server's figure lands with the response; this only has to be close.
            const buildMs = Math.round((catalogById.value.get(def.id)?.buildMs ?? 0) * (s?.mood?.buildTime ?? 1))
            sites.push({
                id: `opt:${++tempSeq}`,
                plotId: item.plotId,
                type: def.id,
                tileX: item.tileX,
                tileY: item.tileY,
                rotation: item.rotation,
                level: road ? 1 : stage,
                upgradingTo: null,
                completesAt: instant ? now : now + townBoostedJobMs(buildMs, now, boosts.value.build),
                createdAt: now,
                staffing: null,
                connected: true,
                district: null,
                jobMs: instant ? null : buildMs,
                nextUpgradeMs: null,
                supply: null,
                throughput: null
            })
        }
        return { sites, coins, goods, usedCredit }
    }

    /** A drag (or one click): every tile it painted, laid in one transaction. */
    function placeBuildings(items: Placement[]) {
        const plan = planPlacements(items)
        const request = inTurn(plan.sites.map(b => b.id), () => post<PlaceResult>('/api/town/building/place-bulk', { items }))
        // Nothing would go up by the client's count: let the server say why.
        if (plan.sites.length === 0) return optimistic(null, request)
        const temps = new Map(plan.sites.map(b => [siteKey(b), b.id]))
        const resolvers = new Map<string, (id: string | null) => void>()
        for (const b of plan.sites) tempIds.set(b.id, new Promise(resolve => resolvers.set(b.id, resolve)))
        const touched = new Set(plan.sites.map(b => b.plotId))
        return optimistic((s) => {
            const credit = { ...(s.monumentCredit ?? {}) }
            for (const id of plan.usedCredit) delete credit[id]
            return {
                ...s,
                buildings: [...(s.buildings ?? []), ...plan.sites],
                inventory: addGoods(s.inventory, plan.goods, -1),
                monumentCredit: credit,
                // Building on a listed plot takes it off the market.
                plots: s.plots?.map(p => touched.has(p.id) && p.listPrice !== null ? { ...p, listPrice: null } : p)
            }
        }, request, {
            coins: plan.coins,
            landed: (res) => {
                const named = new Map<string, PlacedSite>()
                for (const p of res.placed) {
                    const temp = temps.get(siteKey(p))
                    if (temp) named.set(temp, p)
                }
                for (const [temp, resolve] of resolvers) {
                    const real = named.get(temp)?.buildingId ?? null
                    resolve(real)
                    // Whatever is already queued on the site waits there under its real id too.
                    const queued = buildingQueue.get(temp)
                    if (real && queued) buildingQueue.set(real, queued)
                }
                // Real ids and the server's timers in; tiles it skipped come back off.
                mutate(s => ({
                    ...s,
                    buildings: (s.buildings ?? []).flatMap((b) => {
                        if (!resolvers.has(b.id)) return [b]
                        const p = named.get(b.id)
                        return p ? [{ ...b, id: p.buildingId, completesAt: p.completesAt }] : []
                    }),
                    // A site stored before the server named it.
                    storage: s.storage && {
                        items: s.storage.items.flatMap((i) => {
                            if (!resolvers.has(i.id)) return [i]
                            const p = named.get(i.id)
                            return p ? [{ ...i, id: p.buildingId }] : []
                        })
                    },
                    monumentJob: s.monumentJob && named.has(s.monumentJob) ? named.get(s.monumentJob)!.buildingId : s.monumentJob
                }))
            },
            failed: () => {
                for (const resolve of resolvers.values()) resolve(null)
            }
        })
    }

    /** A whole selection moved together, all or nothing. */
    function moveBuildings(moves: TownSpot[]) {
        const byId = new Map(moves.map(m => [m.buildingId, m]))
        const touched = new Set(moves.map(m => m.plotId))
        return optimistic(s => ({
            ...s,
            buildings: s.buildings?.map((b) => {
                const m = byId.get(b.id)
                return m ? { ...b, plotId: m.plotId, tileX: m.tileX, tileY: m.tileY, rotation: m.rotation } : b
            }),
            plots: s.plots?.map(p => touched.has(p.id) && p.listPrice !== null ? { ...p, listPrice: null } : p)
        }), inTurn(moves.map(m => m.buildingId), async () => post<{ moved: string[] }>('/api/town/building/move-bulk', { moves: await realSpots(moves) })))
    }

    /** Take buildings off the map into storage. Null when none of them is on the map any more. */
    function storeBuildings(buildingIds: string[]) {
        const ids = new Set(buildingIds)
        if (!buildings.value.some(b => ids.has(b.id))) return Promise.resolve(null)
        const now = serverNow()
        return optimistic((s) => {
            const taken = (s.buildings ?? []).filter(b => ids.has(b.id)).map(b => finished(b, now))
            const items: TownStoredView[] = taken.map((b) => {
                const job = b.level === 0 || b.upgradingTo !== null
                const remainingMs = job ? Math.max(0, b.completesAt - now) : 0
                return { id: b.id, type: b.type, level: b.level, upgradingTo: b.upgradingTo, remainingMs, storedAt: now, createdAt: b.createdAt, paused: townStoredIsJob({ level: b.level, upgradingTo: b.upgradingTo, remainingMs }) }
            })
            return {
                ...s,
                buildings: (s.buildings ?? []).filter(b => !ids.has(b.id)),
                storage: { items: [...(s.storage?.items ?? []), ...items] }
            }
        }, inTurn(buildingIds, async () => post<{ stored: string[] }>('/api/town/storage/store', { buildingIds: await realIds(buildingIds) })))
    }

    /** Bring a stored building back out. Null when it already left storage. */
    function placeStored(spot: TownSpot) {
        const item = storage.value.items.find(i => i.id === spot.buildingId)
        if (!item) return Promise.resolve(null)
        const now = serverNow()
        // A paused job picks up where it stopped.
        const building: TownBuildingView = {
            id: item.id,
            plotId: spot.plotId,
            type: item.type,
            tileX: spot.tileX,
            tileY: spot.tileY,
            rotation: spot.rotation,
            level: item.level,
            upgradingTo: item.paused ? item.upgradingTo : null,
            completesAt: item.paused ? now + item.remainingMs : now,
            createdAt: item.createdAt,
            staffing: null,
            connected: true,
            district: null,
            jobMs: null,
            nextUpgradeMs: null,
            supply: null,
            throughput: null
        }
        return optimistic(s => ({
            ...s,
            buildings: [...(s.buildings ?? []), building],
            storage: { items: (s.storage?.items ?? []).filter(i => i.id !== item.id) },
            plots: s.plots?.map(p => p.id === spot.plotId && p.listPrice !== null ? { ...p, listPrice: null } : p)
        }), inTurn([spot.buildingId], async () => {
            const [real] = await realSpots([spot])
            if (!real) {
                const message = 'That building is not in storage'
                throw Object.assign(new Error(message), { data: { statusMessage: message } })
            }
            return post<{ buildingId: string }>('/api/town/storage/place', { ...real })
        }))
    }

    /** Clear a selection. Monuments stay standing; null when nothing is left to clear. */
    function demolishBuildings(buildingIds: string[]) {
        const ids = new Set(buildingIds.filter(id => buildings.value.some(b => b.id === id && catalogById.value.get(b.type)?.kind !== 'monument')))
        if (ids.size === 0) return Promise.resolve(null)
        return optimistic(
            s => ({ ...s, buildings: (s.buildings ?? []).filter(b => !ids.has(b.id)) }),
            inTurn([...ids], async () => post<{ demolished: string[], types: string[] }>('/api/town/building/demolish-bulk', { buildingIds: await realIds([...ids]) }))
        )
    }

    /**
     * Start an upgrade on every building in a selection that can take one, in
     * order, until the crews, coins or goods run out, the way the server does.
     * Null when every one of them is already on a job.
     */
    function upgradeBuildings(buildingIds: string[]) {
        const now = serverNow()
        const byId = new Map(buildings.value.map(b => [b.id, b]))
        const ids = buildingIds.filter((id) => {
            const b = byId.get(id)
            return !b || !jobRunning(b, now)
        })
        if (ids.length === 0) return Promise.resolve(null)
        const wallet = purse()
        let crews = buildersFree.value
        let monumentCrew = monumentJob.value === null
        const started = new Map<string, Partial<TownBuildingView>>()
        const goods: Record<string, number> = {}
        let coins = 0
        for (const id of ids) {
            const found = byId.get(id)
            const b = found && finished(found, now)
            const def = b && getTownBuilding(b.type)
            // No quote from the server for the next level: leave this one to it.
            if (!b || !def || b.level === 0 || b.upgradingTo !== null || def.kind === 'road' || b.level >= townBuildingMaxLevel(def) || b.nextUpgradeMs === null) continue
            const monument = def.kind === 'monument'
            if (monument ? !monumentCrew : crews <= 0) continue
            const cost = townLevelCost(def, b.level + 1)
            if (!wallet.affords(cost)) continue
            wallet.spend(cost)
            coins += cost.coins
            for (const [r, q] of Object.entries(cost.resources)) goods[r] = (goods[r] ?? 0) + q
            if (monument) monumentCrew = false
            else crews--
            started.set(id, {
                level: b.level,
                upgradingTo: b.level + 1,
                completesAt: now + townBoostedJobMs(b.nextUpgradeMs, now, boosts.value.build),
                jobMs: b.nextUpgradeMs
            })
        }
        type UpgradeResult = { started: { buildingId: string, level: number, completesAt: number }[], skipped: number, reason: string | null }
        const request = inTurn(ids, async () => post<UpgradeResult>('/api/town/building/upgrade-bulk', { buildingIds: await realIds(ids) }))
        if (started.size === 0) return optimistic(null, request)
        return optimistic(s => ({
            ...s,
            buildings: s.buildings?.map(b => started.has(b.id) ? { ...b, ...started.get(b.id) } : b),
            inventory: addGoods(s.inventory, goods, -1)
        }), request, {
            coins,
            landed: (res) => {
                const at = new Map(res.started.map(u => [u.buildingId, u.completesAt]))
                mutate(s => ({ ...s, buildings: s.buildings?.map(b => at.has(b.id) ? { ...b, completesAt: at.get(b.id)! } : b) }))
            }
        })
    }

    /** Finish a job for gems. Null when the building has nothing running. */
    function rushBuilding(buildingId: string) {
        const now = serverNow()
        const b = buildings.value.find(x => x.id === buildingId)
        if (b && !jobRunning(b, now)) return Promise.resolve(null)
        return optimistic(
            s => ({ ...s, buildings: s.buildings?.map(x => x.id === buildingId ? { ...x, level: x.upgradingTo ?? 1, upgradingTo: null, completesAt: now, jobMs: null } : x) }),
            inTurn([buildingId], async () => post<{ gems: number, level: number }>('/api/town/building/rush', { buildingId: (await realIds([buildingId]))[0] ?? buildingId })),
            { gems: true }
        )
    }

    function sellGoods(items: { resource: string, quantity: number }[]) {
        const bag: Record<string, number> = {}
        for (const i of items) bag[i.resource] = (bag[i.resource] ?? 0) + i.quantity
        return (s: TownState) => ({ ...s, inventory: addGoods(s.inventory, bag, -1) })
    }

    return {
        state,
        pending,
        refresh,
        idle,
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
        storage,
        redesignDraft,
        foundTown: () => optimistic(null, () => post('/api/town/init'), { awaitState: true }),
        /** Keep a half-done redesign on the server. The town itself does not change. */
        saveRedesignDraft: (draft: TownRedesignDraft) => optimistic(null, () => post<{ savedAt: number }>('/api/town/redesign/draft', { ...draft })),
        discardRedesignDraft: () => optimistic(
            s => ({ ...s, redesignDraft: null }),
            () => $fetch('/api/town/redesign/draft' as string, { method: 'DELETE' })
        ),
        storeBuildings,
        placeStored,
        claimMilestone: (id: string) => {
            const goal = milestones.value.find(m => m.id === id)
            if (goal?.claimed) return Promise.resolve(null)
            return optimistic(
                s => ({ ...s, milestones: s.milestones?.map(m => m.id === id ? { ...m, claimed: true } : m) }),
                () => post<{ id: string, reward: number, gems: number, title: string }>('/api/town/milestone/claim', { id }),
                // The reward is known: it shows at once, and comes back off if the claim fails.
                { coins: -(goal?.reward ?? 0), gems: !!goal?.gems }
            )
        },
        placeBuilding: (plotId: string, tileX: number, tileY: number, type: string, rotation = 0) =>
            placeBuildings([{ plotId, tileX, tileY, type, rotation }]),
        moveBuilding: (buildingId: string, plotId: string, tileX: number, tileY: number, rotation: number) =>
            moveBuildings([{ buildingId, plotId, tileX, tileY, rotation }]),
        placeBuildings,
        moveBuildings,
        /**
         * The whole town laid out again: every kept building's new tile, roads to
         * lay fresh, buildings going into storage, and stored ones coming out.
         * Roads left out are removed. Resolves once the new layout is in, so the
         * redesign view can close straight onto it.
         */
        redesign: (moves: TownSpot[], roads: { plotId: string, tileX: number, tileY: number }[], store: string[] = [], place: TownSpot[] = []) =>
            optimistic(null, () => post<{ moved: string[], removed: string[], built: string[], coins: number, stored: string[], placed: string[] }>('/api/town/redesign', { moves, roads, store, place }), { awaitState: true }),
        demolishBuildings,
        upgradeBuildings,
        sellBulk: (items: { resource: string, quantity: number }[]) =>
            optimistic(sellGoods(items), () => post<{ total: number, lines: { resource: string, quantity: number, total: number }[], resources: string[], marketBonus: number }>('/api/town/market/sell-bulk', { items })),
        upgradeBuilding: (buildingId: string) => upgradeBuildings([buildingId]),
        rushBuilding,
        demolishBuilding: (buildingId: string) => demolishBuildings([buildingId]),
        listPlot: (plotId: string, price: number | null) =>
            optimistic(
                s => ({ ...s, plots: s.plots?.map(p => p.id === plotId ? { ...p, listPrice: price } : p) }),
                () => post<{ plotId: string, listPrice: number | null }>('/api/town/plot/list', { plotId, price }),
                { world: true }
            ),
        sellPlot: (plotId: string) => optimistic(null, () => post<{ plotId: string, refund: number }>('/api/town/plot/sell', { plotId }), { world: true }),
        buyPlotFromPlayer: (plotId: string, expectedPrice: number) => optimistic(null, () => post<{ plotId: string, price: number }>('/api/town/plot/buy-from-player', { plotId, expectedPrice }), { world: true }),
        buyPlot: (x: number, y: number) => optimistic(null, () => post<{ plotId: string, price: number }>('/api/town/plot/buy', { x, y }), { world: true }),
        hireBuilder: () => optimistic(null, () => post<{ builders: number, gems: number }>('/api/town/builder'), { gems: true }),
        sellToFloor: (resource: string, quantity: number) =>
            optimistic(sellGoods([{ resource, quantity }]), () => post<{ total: number, quantity: number, toPlayers: number, toHall: number, filledByPlayers: number, marketBonus: number }>('/api/town/market/sell-floor', { resource, quantity })),
        convertJewels: (gems: number) => optimistic(null, () => post<{ gems: number, jewels: number }>('/api/town/market/convert', { gems }), { gems: true }),
        placeOrder: (resource: string, side: 'buy' | 'sell', price: number, quantity: number) =>
            optimistic(null, () => post<{ status: 'open' | 'filled', filled: number, coinsMoved: number }>('/api/town/market/place', { resource, side, price, quantity })),
        cancelOrder: (orderId: string) => {
            const order = myOrders.value.find(o => o.id === orderId)
            if (!order) return Promise.resolve(null)
            // A sell's unfilled goods come straight back; a buy's coins come with the response.
            const back = order.side === 'sell' ? { [order.resource]: order.quantity - order.filled } : {}
            return optimistic(
                s => ({ ...s, myOrders: s.myOrders?.filter(o => o.id !== orderId), inventory: addGoods(s.inventory, back, 1) }),
                () => post('/api/town/market/cancel', { orderId })
            )
        }
    }
}
