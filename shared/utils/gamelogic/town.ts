// ─── Polytown — plot-based idle town builder ─────────────────────────────────
// Players own 8x8 plots on an endless grid, place production buildings that
// turn raw resources into ever more valuable goods, and sell the output either
// to the system (a guaranteed floor price) or to each other on a per-resource
// order book. Everything that decides an outcome lives here so the server and
// the client (for previews / countdowns) agree on the numbers.
//
// Pacing target: one plot of farms earns roughly what a fresh Colony does
// (~50k coins/day at floor); a full tier-6 chain over several plots lands in
// the hundreds of millions per day after months, matching Colony/Xeno maxes.

export const TOWN_PLOT_SIZE = 8
export const TOWN_TILES_PER_PLOT = TOWN_PLOT_SIZE * TOWN_PLOT_SIZE

/** One production tick. Every completed building produces once per tick. */
export const TOWN_TICK_MS = 60_000
/** Offline production accrues for at most this long; longer absences are lost. */
export const TOWN_MAX_OFFLINE_MS = 8 * 60 * 60_000

/** Base per-resource storage, before warehouses. Production stops at the cap. */
export const TOWN_BASE_STORAGE = 2_000
export const TOWN_WAREHOUSE_STORAGE = 5_000

/** Rushing a build costs one gem per this many ms remaining, rounded up. */
export const TOWN_RUSH_MS_PER_GEM = 5 * 60_000

/** Second plot waits 10 min after founding; every further plot triples the wait. */
export const TOWN_PLOT_COOLDOWN_BASE_MS = 10 * 60_000
export const TOWN_PLOT_COOLDOWN_GROWTH = 3
export const TOWN_PLOT_PRICE_BASE = 100_000
export const TOWN_PLOT_PRICE_GROWTH = 2.5
export const TOWN_MAX_PLOTS = 12

/** Building level cap and per-level cost growth (coins and resources alike). */
export const TOWN_MAX_BUILDING_LEVEL = 20
export const TOWN_LEVEL_COST_GROWTH = 1.7
export const TOWN_LEVEL_TIME_GROWTH = 1.25

/** Happiness lives in [0, 100] and drifts toward its target this much per tick. Crowding = more jobs than residents. */
export const TOWN_HAPPINESS_START = 50
export const TOWN_HAPPINESS_BASE_TARGET = 60
export const TOWN_HAPPINESS_DRIFT_PER_TICK = 2
export const TOWN_HAPPINESS_INDUSTRY_PENALTY = 1
/** Industry smog is a bounded pressure, not a death spiral for a big town. */
export const TOWN_HAPPINESS_INDUSTRY_CAP = 20
export const TOWN_HAPPINESS_CROWDING_PENALTY = 10
export const TOWN_HAPPINESS_CROWDING_RATIO = 1
/** Penalty when the town has no food at all (neither wheat nor bread was eaten this tick). */
export const TOWN_HAPPINESS_STARVING_PENALTY = 12
/** Parks cheer every house within this Chebyshev radius (2 = a 5×5 square); industry sours the adjacent ones. */
export const TOWN_PARK_RADIUS = 2
export const TOWN_INDUSTRY_RADIUS = 1
export const TOWN_HAPPINESS_PARK_NEARBY = 2
export const TOWN_HAPPINESS_INDUSTRY_ADJACENT = 1
/** Total layout bonus/penalty is clamped to this magnitude so 60 houses × 4 parks cannot pin happiness. */
export const TOWN_HAPPINESS_LAYOUT_CAP = 30
/** Welcome-back summary is shown for absences at least this long. */
export const TOWN_WELCOME_BACK_MIN_MS = 5 * 60_000

/** Player offers may not exceed this multiple of the floor. The system never sells — only players do. */
export const TOWN_CEILING_MULTIPLIER = 10
export const TOWN_MARKET_MAX_OPEN_ORDERS = 50
export const TOWN_MARKET_HISTORY_LIMIT = 40
export const TOWN_MARKET_BOOK_DEPTH = 12
export const TOWN_MARKET_MIN_PRICE = 0.01

// ─── Resources ───────────────────────────────────────────────────────────────

export const TOWN_RESOURCE_IDS = [
    'wheat', 'wood', 'stone',
    'flour', 'planks', 'bricks',
    'bread', 'tools',
    'ore', 'steel',
    'machines',
    'luxuries'
] as const
export type TownResourceId = typeof TOWN_RESOURCE_IDS[number]

export interface TownResourceDef {
    id: TownResourceId
    name: string
    emoji: string
    tier: number
    /** Coins the system always pays per unit. */
    floorPrice: number
}

export const TOWN_RESOURCES: readonly TownResourceDef[] = [
    { id: 'wheat', name: 'Wheat', emoji: '🌾', tier: 1, floorPrice: 5 },
    { id: 'wood', name: 'Wood', emoji: '🪵', tier: 1, floorPrice: 5 },
    { id: 'stone', name: 'Stone', emoji: '🪨', tier: 1, floorPrice: 8 },
    { id: 'flour', name: 'Flour', emoji: '🌕', tier: 2, floorPrice: 22 },
    { id: 'planks', name: 'Planks', emoji: '🪚', tier: 2, floorPrice: 22 },
    { id: 'bricks', name: 'Bricks', emoji: '🧱', tier: 2, floorPrice: 36 },
    { id: 'bread', name: 'Bread', emoji: '🍞', tier: 3, floorPrice: 110 },
    { id: 'tools', name: 'Tools', emoji: '🔧', tier: 3, floorPrice: 200 },
    { id: 'ore', name: 'Iron Ore', emoji: '⛏️', tier: 4, floorPrice: 100 },
    { id: 'steel', name: 'Steel', emoji: '⚙️', tier: 4, floorPrice: 900 },
    { id: 'machines', name: 'Machines', emoji: '🏭', tier: 5, floorPrice: 6_000 },
    { id: 'luxuries', name: 'Luxuries', emoji: '💎', tier: 6, floorPrice: 40_000 }
]

const RESOURCE_BY_ID = new Map(TOWN_RESOURCES.map(r => [r.id, r]))

export function getTownResource(id: string): TownResourceDef | undefined {
    return RESOURCE_BY_ID.get(id as TownResourceId)
}

export function isTownResourceId(id: string): id is TownResourceId {
    return RESOURCE_BY_ID.has(id as TownResourceId)
}

export function townFloorPrice(id: TownResourceId): number {
    return RESOURCE_BY_ID.get(id)!.floorPrice
}

export function townCeilingPrice(id: TownResourceId): number {
    return RESOURCE_BY_ID.get(id)!.floorPrice * TOWN_CEILING_MULTIPLIER
}

export type TownResourceBag = Partial<Record<TownResourceId, number>>

// ─── Needs ───────────────────────────────────────────────────────────────────
// Townsfolk consume goods every tick. Each need that is fully supplied adds
// its bonus to the happiness target; goods leave the inventory for real, so a
// town has to keep producing (or buying) what its people eat and use.

export interface TownNeedDef {
    resource: TownResourceId
    name: string
    /** One unit is consumed per this many residents per tick (rounded up). */
    perPop: number
    /** The need only appears once the town houses this many residents. */
    minPop: number
    /** Happiness target bonus while supplied. */
    happiness: number
    /** Counts as food: with no food need supplied at all the town takes the starving penalty. */
    food: boolean
    description: string
}

export const TOWN_NEEDS: readonly TownNeedDef[] = [
    { resource: 'wheat', name: 'Grain', perPop: 12, minPop: 1, happiness: 2, food: true, description: 'The staple. A town with no grain and no bread is starving.' },
    { resource: 'bread', name: 'Bread', perPop: 24, minPop: 16, happiness: 4, food: true, description: 'A proper meal. Worth more than grain alone.' },
    { resource: 'tools', name: 'Tools', perPop: 40, minPop: 40, happiness: 3, food: false, description: 'Workers wear tools out. Keep a stock and they work happier.' },
    { resource: 'luxuries', name: 'Luxuries', perPop: 160, minPop: 120, happiness: 6, food: false, description: 'The finer things. A luxury town is a delighted town.' }
]

/** Units of each need the whole town wants per tick at `pop` residents. */
export function townNeedsPerTick(pop: number): Partial<Record<TownResourceId, number>> {
    const out: Partial<Record<TownResourceId, number>> = {}
    if (pop <= 0) return out
    for (const n of TOWN_NEEDS) {
        if (pop < n.minPop) continue
        out[n.resource] = Math.max(1, Math.ceil(pop / n.perPop))
    }
    return out
}

export type TownSatisfied = Partial<Record<TownResourceId, boolean>>

export function needsHappiness(satisfied: TownSatisfied, pop: number): number {
    if (pop <= 0) return 0
    const demand = townNeedsPerTick(pop)
    let total = 0
    let fed = false
    for (const n of TOWN_NEEDS) {
        if (demand[n.resource] === undefined) continue
        if (satisfied[n.resource]) {
            total += n.happiness
            if (n.food) fed = true
        }
    }
    if (!fed) total -= TOWN_HAPPINESS_STARVING_PENALTY
    return total
}

// ─── Buildings ───────────────────────────────────────────────────────────────

export const TOWN_BUILDING_IDS = [
    'house', 'park', 'warehouse',
    'farm', 'lumber', 'quarry',
    'mill', 'sawmill', 'kiln',
    'bakery', 'smithy',
    'mine', 'foundry',
    'factory',
    'emporium'
] as const
export type TownBuildingId = typeof TOWN_BUILDING_IDS[number]

export type TownBuildingKind = 'housing' | 'civic' | 'storage' | 'industry'

export interface TownBuildingDef {
    id: TownBuildingId
    name: string
    emoji: string
    /** Hex color used by the renderer for the roof/body. */
    color: number
    tier: number
    kind: TownBuildingKind
    description: string
    /** Level-1 build cost. Every later level multiplies both by TOWN_LEVEL_COST_GROWTH^(level-1). */
    cost: { coins: number, resources: TownResourceBag }
    /** Extra resources every upgrade (level >= 2) needs, scaled like the rest of the cost. Puts goods back into the town. */
    upgradeResources: TownResourceBag
    /** Level-1 build time. Later levels multiply by TOWN_LEVEL_TIME_GROWTH^(level-1). */
    buildMs: number
    /** Residents needed to run at full speed, per level. 0 for housing/civic. */
    workers: number
    /** Per-tick consumption at level 1 — scaled linearly by level. */
    inputs: TownResourceBag
    /** Per-tick production at level 1 — scaled linearly by level. */
    outputs: TownResourceBag
    /** Residents housed per level (housing only). */
    popCap: number
    /** Happiness target contribution per level (civic only). */
    happiness: number
    /** Extra storage per resource per level (storage only). */
    storage: number
}

const MIN = 60_000

export const TOWN_BUILDINGS: readonly TownBuildingDef[] = [
    {
        id: 'house', name: 'House', emoji: '🏠', color: 0xe9c46a, tier: 0, kind: 'housing',
        description: 'Homes for your townsfolk. Every industry building needs residents to run.',
        cost: { coins: 800, resources: {} }, buildMs: 1 * MIN,
        upgradeResources: { wood: 12 },
        workers: 0, inputs: {}, outputs: {}, popCap: 4, happiness: 0, storage: 0
    },
    {
        id: 'park', name: 'Park', emoji: '🌳', color: 0x52b788, tier: 0, kind: 'civic',
        description: 'Green space. Every house within 2 tiles gets happier — place parks between your homes.',
        cost: { coins: 2_500, resources: { wood: 15 } }, buildMs: 1 * MIN,
        upgradeResources: { wood: 10, stone: 6 },
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 2, storage: 0
    },
    {
        id: 'warehouse', name: 'Warehouse', emoji: '📦', color: 0x8d99ae, tier: 2, kind: 'storage',
        description: 'Raises the storage cap of every resource. Full storage halts production.',
        cost: { coins: 40_000, resources: { planks: 40, bricks: 30 } }, buildMs: 8 * MIN,
        upgradeResources: { planks: 20, bricks: 10 },
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 0, storage: TOWN_WAREHOUSE_STORAGE
    },
    {
        id: 'farm', name: 'Farm', emoji: '🌾', color: 0xd4a373, tier: 1, kind: 'industry',
        description: 'Grows wheat. The simplest way to start earning.',
        cost: { coins: 1_000, resources: {} }, buildMs: 2 * MIN,
        upgradeResources: { wood: 8 },
        workers: 1, inputs: {}, outputs: { wheat: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'lumber', name: 'Lumber Camp', emoji: '🪵', color: 0x6f4e37, tier: 1, kind: 'industry',
        description: 'Fells trees for wood.',
        cost: { coins: 1_000, resources: {} }, buildMs: 2 * MIN,
        upgradeResources: { stone: 8 },
        workers: 1, inputs: {}, outputs: { wood: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'quarry', name: 'Quarry', emoji: '🪨', color: 0x9a8c98, tier: 1, kind: 'industry',
        description: 'Cuts stone from the ground.',
        cost: { coins: 1_600, resources: {} }, buildMs: 3 * MIN,
        upgradeResources: { wood: 10 },
        workers: 1, inputs: {}, outputs: { stone: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'mill', name: 'Mill', emoji: '🌕', color: 0xf4e285, tier: 2, kind: 'industry',
        description: 'Grinds wheat into flour.',
        cost: { coins: 40_000, resources: { wood: 60, stone: 40 } }, buildMs: 5 * MIN,
        upgradeResources: { planks: 12, stone: 8 },
        workers: 2, inputs: { wheat: 2 }, outputs: { flour: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'sawmill', name: 'Sawmill', emoji: '🪚', color: 0xbc6c25, tier: 2, kind: 'industry',
        description: 'Saws wood into planks.',
        cost: { coins: 40_000, resources: { wood: 60, stone: 40 } }, buildMs: 5 * MIN,
        upgradeResources: { planks: 12, stone: 8 },
        workers: 2, inputs: { wood: 2 }, outputs: { planks: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'kiln', name: 'Brick Kiln', emoji: '🧱', color: 0xc1440e, tier: 2, kind: 'industry',
        description: 'Fires stone into bricks.',
        cost: { coins: 60_000, resources: { wood: 80, stone: 60 } }, buildMs: 6 * MIN,
        upgradeResources: { planks: 12, bricks: 8 },
        workers: 2, inputs: { stone: 2 }, outputs: { bricks: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'bakery', name: 'Bakery', emoji: '🍞', color: 0xf77f00, tier: 3, kind: 'industry',
        description: 'Bakes bread. Fed townsfolk are happier, and bread sells well.',
        cost: { coins: 400_000, resources: { planks: 80, bricks: 60, wheat: 100 } }, buildMs: 15 * MIN,
        upgradeResources: { bricks: 20, tools: 4 },
        workers: 3, inputs: { flour: 2, wood: 1 }, outputs: { bread: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'smithy', name: 'Smithy', emoji: '🔧', color: 0x4a4e69, tier: 3, kind: 'industry',
        description: 'Forges tools from planks and bricks. Tools unlock heavy industry.',
        cost: { coins: 600_000, resources: { planks: 100, bricks: 100, stone: 100 } }, buildMs: 20 * MIN,
        upgradeResources: { bricks: 20, tools: 4 },
        workers: 3, inputs: { planks: 2, bricks: 2 }, outputs: { tools: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'mine', name: 'Iron Mine', emoji: '⛏️', color: 0x3d405b, tier: 4, kind: 'industry',
        description: 'Digs iron ore. Needs tools to build and to keep running.',
        cost: { coins: 3_000_000, resources: { tools: 60, bricks: 200, planks: 150 } }, buildMs: 40 * MIN,
        upgradeResources: { tools: 20, planks: 40 },
        workers: 4, inputs: { tools: 1 }, outputs: { ore: 3 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'foundry', name: 'Foundry', emoji: '⚙️', color: 0x9d0208, tier: 4, kind: 'industry',
        description: 'Smelts ore into steel.',
        cost: { coins: 10_000_000, resources: { tools: 120, bricks: 400, planks: 200 } }, buildMs: 60 * MIN,
        upgradeResources: { tools: 30, bricks: 60 },
        workers: 5, inputs: { ore: 3, wood: 2 }, outputs: { steel: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'factory', name: 'Factory', emoji: '🏭', color: 0x577590, tier: 5, kind: 'industry',
        description: 'Assembles machines from steel, planks and tools.',
        cost: { coins: 60_000_000, resources: { steel: 200, tools: 300, bricks: 500 } }, buildMs: 2 * 60 * MIN,
        upgradeResources: { steel: 40, tools: 40 },
        workers: 8, inputs: { steel: 3, planks: 3, tools: 1 }, outputs: { machines: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'emporium', name: 'Emporium', emoji: '💎', color: 0x7b2cbf, tier: 6, kind: 'industry',
        description: 'Crafts luxuries — the most valuable good a town can produce.',
        cost: { coins: 500_000_000, resources: { machines: 60, steel: 500, tools: 400, bread: 500 } }, buildMs: 4 * 60 * MIN,
        upgradeResources: { machines: 10, steel: 80 },
        workers: 12, inputs: { machines: 2, bread: 4, tools: 2 }, outputs: { luxuries: 1 }, popCap: 0, happiness: 0, storage: 0
    }
]

const BUILDING_BY_ID = new Map(TOWN_BUILDINGS.map(b => [b.id, b]))

export function getTownBuilding(id: string): TownBuildingDef | undefined {
    return BUILDING_BY_ID.get(id as TownBuildingId)
}

export function isTownBuildingId(id: string): id is TownBuildingId {
    return BUILDING_BY_ID.has(id as TownBuildingId)
}

// ─── Costs, timers, scaling ──────────────────────────────────────────────────

export function scaleBag(bag: TownResourceBag, factor: number, round: (n: number) => number = Math.round): TownResourceBag {
    const out: TownResourceBag = {}
    for (const [id, qty] of Object.entries(bag) as [TownResourceId, number][]) {
        const scaled = round(qty * factor)
        if (scaled > 0) out[id] = scaled
    }
    return out
}

/** Coins + resources to build (level 1) or upgrade TO `level`. */
export function townLevelCost(def: TownBuildingDef, level: number): { coins: number, resources: TownResourceBag } {
    const factor = Math.pow(TOWN_LEVEL_COST_GROWTH, level - 1)
    const resources = scaleBag(def.cost.resources, factor)
    if (level >= 2) {
        for (const [id, qty] of Object.entries(scaleBag(def.upgradeResources, factor)) as [TownResourceId, number][]) {
            resources[id] = (resources[id] ?? 0) + qty
        }
    }
    return { coins: Math.round(def.cost.coins * factor), resources }
}

/** Build/upgrade duration in ms for reaching `level`. */
export function townLevelBuildMs(def: TownBuildingDef, level: number): number {
    return Math.round(def.buildMs * Math.pow(TOWN_LEVEL_TIME_GROWTH, level - 1))
}

/** Gems needed to finish a build with `remainingMs` left on the clock. */
export function townRushGemCost(remainingMs: number): number {
    if (remainingMs <= 0) return 0
    return Math.ceil(remainingMs / TOWN_RUSH_MS_PER_GEM)
}

/**
 * Cooldown before buying plot number `plotIndex` (1-based; the first plot is
 * free on founding and has none). 10 min for the second, tripling after.
 */
export function townPlotCooldownMs(plotIndex: number): number {
    if (plotIndex <= 1) return 0
    return Math.round(TOWN_PLOT_COOLDOWN_BASE_MS * Math.pow(TOWN_PLOT_COOLDOWN_GROWTH, plotIndex - 2))
}

export function townPlotPrice(plotIndex: number): number {
    if (plotIndex <= 1) return 0
    return Math.round(TOWN_PLOT_PRICE_BASE * Math.pow(TOWN_PLOT_PRICE_GROWTH, plotIndex - 2))
}

/**
 * Plot world coordinates for the n-th plot ever claimed (0-based), walking an
 * outward square spiral from the origin so the world stays compact.
 */
export function townSpiralCoords(index: number): { x: number, y: number } {
    if (index === 0) return { x: 0, y: 0 }
    const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2)
    const side = ring * 2
    const start = (side - 1) * (side - 1)
    const offset = index - start
    const leg = Math.floor(offset / side)
    const step = offset % side
    switch (leg) {
        case 0: return { x: ring, y: -ring + 1 + step }
        case 1: return { x: ring - 1 - step, y: ring }
        case 2: return { x: -ring, y: ring - 1 - step }
        default: return { x: -ring + 1 + step, y: -ring }
    }
}

// ─── Simulation ──────────────────────────────────────────────────────────────

export interface TownSimBuilding {
    id: string
    type: TownBuildingId
    level: number
    /** Epoch ms when construction (or the current upgrade) finishes. */
    completesAt: number
    /** Level being upgraded to, or null when not upgrading. A building under its first build has level 0. */
    upgradingTo: number | null
    createdAt: number
    /** World tile coordinates (plot.x * 8 + tileX). Optional: adjacency effects are skipped without them. */
    wx?: number
    wy?: number
}

export interface TownSimState {
    happiness: number
    tickProgressMs: number
    lastSettledAt: number
    inventory: TownResourceBag
    buildings: TownSimBuilding[]
}

export interface TownDerived {
    popCap: number
    workersDemanded: number
    /** Residents actually employed (min of demand and cap). */
    workersEmployed: number
    happinessTarget: number
    /** Per-resource storage cap. */
    storageCap: number
    industryTiles: number
    /** Buildings staffed enough to run, with their staffing ratio (0..1). */
    staffing: Map<string, number>
    /** Happiness → production speed multiplier, 0.5 .. 1.0. */
    speedMultiplier: number
    /** Units the town consumes per tick for each need. */
    needsPerTick: Partial<Record<TownResourceId, number>>
}

/** A building counts as operational once its first build is done. */
export function isBuilt(b: TownSimBuilding, now: number): boolean {
    return b.level > 0 || b.completesAt <= now
}

/** Effective level right now — a finished upgrade counts even before settle. */
export function effectiveLevel(b: TownSimBuilding, now: number): number {
    if (b.completesAt <= now) {
        if (b.upgradingTo !== null) return b.upgradingTo
        if (b.level === 0) return 1
    }
    return b.level
}

/** Effect radius (Chebyshev) a building projects onto houses, or 0 for none. */
export function townEffectRadius(def: TownBuildingDef): number {
    if (def.kind === 'civic') return TOWN_PARK_RADIUS
    if (def.kind === 'industry') return TOWN_INDUSTRY_RADIUS
    return 0
}

function within(a: TownSimBuilding, wx: number, wy: number, r: number) {
    return a.wx !== undefined && a.wy !== undefined && Math.max(Math.abs(a.wx - wx), Math.abs(a.wy - wy)) <= r && !(a.wx === wx && a.wy === wy)
}

/**
 * Layout matters, City-Skylines style: every park cheers each house within
 * TOWN_PARK_RADIUS, every industry building sours each house right beside it.
 * Summed over (house, source) pairs and clamped, using world tile coordinates.
 */
export function adjacencyHappiness(buildings: TownSimBuilding[]): number {
    let total = 0
    for (const b of buildings) {
        if (b.type !== 'house' || b.wx === undefined || b.wy === undefined) continue
        const { parks, industry } = houseAdjacency(buildings, b.wx, b.wy, Infinity)
        total += parks * TOWN_HAPPINESS_PARK_NEARBY - industry * TOWN_HAPPINESS_INDUSTRY_ADJACENT
    }
    return Math.max(-TOWN_HAPPINESS_LAYOUT_CAP, Math.min(TOWN_HAPPINESS_LAYOUT_CAP, total))
}

/** What a house on `wx,wy` gets from its surroundings (built buildings only). */
export function houseAdjacency(buildings: TownSimBuilding[], wx: number, wy: number, now = Date.now()): { parks: number, industry: number } {
    let parks = 0
    let industry = 0
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const def = BUILDING_BY_ID.get(b.type)!
        if (def.kind === 'civic' && within(b, wx, wy, TOWN_PARK_RADIUS)) parks++
        else if (def.kind === 'industry' && within(b, wx, wy, TOWN_INDUSTRY_RADIUS)) industry++
    }
    return { parks, industry }
}

/**
 * Tier N buildings (N >= 2) unlock once any tier N-1 building has finished
 * construction — buying your way up the chain through the ceiling market is
 * not a shortcut past actually running the previous tier.
 */
export function townTierUnlocked(buildings: TownSimBuilding[], tier: number, now: number): boolean {
    if (tier <= 1) return true
    return buildings.some(b => isBuilt(b, now) && BUILDING_BY_ID.get(b.type)!.tier === tier - 1)
}

/** Net resource change per tick at current staffing, assuming inputs are available. */
export function townNetPerTick(buildings: TownSimBuilding[], derived: TownDerived, now: number): TownResourceBag {
    const net: TownResourceBag = {}
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const def = BUILDING_BY_ID.get(b.type)!
        if (def.kind !== 'industry') continue
        const level = effectiveLevel(b, now)
        const ratio = derived.staffing.get(b.id) ?? 0
        if (ratio <= 0) continue
        for (const [id, qty] of Object.entries(scaleBag(def.outputs, level * ratio, Math.floor)) as [TownResourceId, number][]) {
            net[id] = (net[id] ?? 0) + qty
        }
        for (const [id, qty] of Object.entries(scaleBag(def.inputs, level * ratio, Math.ceil)) as [TownResourceId, number][]) {
            net[id] = (net[id] ?? 0) - qty
        }
    }
    for (const [id, qty] of Object.entries(derived.needsPerTick) as [TownResourceId, number][]) {
        net[id] = (net[id] ?? 0) - qty
    }
    return net
}

export function townSpeedMultiplier(happiness: number): number {
    return 0.5 + Math.max(0, Math.min(100, happiness)) / 200
}

/**
 * Everything the tick loop needs that only depends on the current layout.
 * Workers are handed out oldest building first, so a town that outgrows its
 * housing sees its newest industry idle rather than everything slowing down.
 */
export function deriveTown(buildings: TownSimBuilding[], happiness: number, now: number, satisfied: TownSatisfied = {}): TownDerived {
    let popCap = 0
    let happinessTarget = TOWN_HAPPINESS_BASE_TARGET
    let storageCap = TOWN_BASE_STORAGE
    let industryTiles = 0
    let workersDemanded = 0

    const built = buildings
        .filter(b => isBuilt(b, now))
        .map(b => ({ b, def: BUILDING_BY_ID.get(b.type)!, level: effectiveLevel(b, now) }))
        .sort((a, z) => a.b.createdAt - z.b.createdAt)

    for (const { def, level } of built) {
        popCap += def.popCap * level
        happinessTarget += def.happiness * level
        storageCap += def.storage * level
        if (def.kind === 'industry') {
            industryTiles++
            workersDemanded += def.workers * level
        }
    }

    happinessTarget -= Math.min(TOWN_HAPPINESS_INDUSTRY_CAP, industryTiles * TOWN_HAPPINESS_INDUSTRY_PENALTY)
    happinessTarget += adjacencyHappiness(built.map(x => x.b))
    if (workersDemanded > popCap * TOWN_HAPPINESS_CROWDING_RATIO) {
        happinessTarget -= TOWN_HAPPINESS_CROWDING_PENALTY
    }
    happinessTarget += needsHappiness(satisfied, popCap)
    happinessTarget = Math.max(0, Math.min(100, happinessTarget))

    const staffing = new Map<string, number>()
    let remaining = popCap
    for (const { b, def, level } of built) {
        if (def.kind !== 'industry') continue
        const need = def.workers * level
        const got = Math.min(need, remaining)
        remaining -= got
        staffing.set(b.id, need === 0 ? 1 : got / need)
    }

    return {
        popCap,
        workersDemanded,
        workersEmployed: popCap - remaining,
        happinessTarget,
        storageCap,
        industryTiles,
        staffing,
        speedMultiplier: townSpeedMultiplier(happiness),
        needsPerTick: townNeedsPerTick(popCap)
    }
}

export interface TownSettleResult {
    happiness: number
    tickProgressMs: number
    lastSettledAt: number
    /** Net inventory change per resource over the settled window. */
    delta: TownResourceBag
    ticks: number
    /** Buildings whose build/upgrade completed during the window, with their new level. */
    completed: { id: string, level: number }[]
    /** Which needs the last tick could supply (or current stock, if no tick ran). */
    satisfied: TownSatisfied
}

/**
 * Advance a town from `state.lastSettledAt` to `now`. Pure and deterministic:
 * the caller persists the returned deltas. Elapsed real time is scaled by the
 * happiness speed multiplier before being cut into ticks, so a sad town simply
 * ticks slower. Each tick, every staffed industry building consumes its inputs
 * (scaled by staffing) and emits its outputs — only when every input is present
 * and the outputs have storage room. Townsfolk then eat bread, which feeds back
 * into the next tick's happiness target.
 */
export function settleTown(state: TownSimState, now: number): TownSettleResult {
    const from = state.lastSettledAt
    const cappedNow = Math.min(now, from + TOWN_MAX_OFFLINE_MS)
    let elapsed = Math.max(0, cappedNow - from)

    const inv: Record<string, number> = { ...state.inventory }
    const delta: TownResourceBag = {}
    const buildings = state.buildings.map(b => ({ ...b }))
    const completed: { id: string, level: number }[] = []

    let happiness = state.happiness
    let progress = state.tickProgressMs
    let ticks = 0
    let satisfied: TownSatisfied = {}
    for (const n of TOWN_NEEDS) satisfied[n.resource] = (inv[n.resource] ?? 0) > 0

    // Walk the window in whole ticks. Buildings that finish mid-window start
    // producing from the tick after their completion timestamp.
    let cursor = from
    let derived = deriveTown(buildings, happiness, cursor, satisfied)
    let guard = 0
    while (elapsed > 0 && guard++ < 100_000) {
        const needMs = (TOWN_TICK_MS - progress) / derived.speedMultiplier
        if (elapsed < needMs) {
            progress += elapsed * derived.speedMultiplier
            cursor += elapsed
            elapsed = 0
            break
        }
        elapsed -= needMs
        cursor += needMs
        progress = 0
        ticks++

        // Re-derive at this instant so newly finished buildings join the tick.
        derived = deriveTown(buildings, happiness, cursor, satisfied)

        for (const b of buildings) {
            if (!isBuilt(b, cursor)) continue
            const def = BUILDING_BY_ID.get(b.type)!
            if (def.kind !== 'industry') continue
            const level = effectiveLevel(b, cursor)
            const ratio = derived.staffing.get(b.id) ?? 0
            if (ratio <= 0) continue
            const inputs = scaleBag(def.inputs, level * ratio, Math.ceil)
            const outputs = scaleBag(def.outputs, level * ratio, Math.floor)
            if (Object.keys(outputs).length === 0) continue

            let ok = true
            for (const [id, qty] of Object.entries(inputs) as [TownResourceId, number][]) {
                if ((inv[id] ?? 0) < qty) { ok = false; break }
            }
            if (!ok) continue
            for (const [id, qty] of Object.entries(outputs) as [TownResourceId, number][]) {
                if ((inv[id] ?? 0) + qty > derived.storageCap) { ok = false; break }
            }
            if (!ok) continue

            for (const [id, qty] of Object.entries(inputs) as [TownResourceId, number][]) {
                inv[id] = (inv[id] ?? 0) - qty
                delta[id] = (delta[id] ?? 0) - qty
            }
            for (const [id, qty] of Object.entries(outputs) as [TownResourceId, number][]) {
                inv[id] = (inv[id] ?? 0) + qty
                delta[id] = (delta[id] ?? 0) + qty
            }
        }

        // The town eats and uses things. A need is only satisfied when the
        // whole tick's demand is in stock — half a loaf feeds nobody.
        satisfied = {}
        for (const [id, qty] of Object.entries(derived.needsPerTick) as [TownResourceId, number][]) {
            if ((inv[id] ?? 0) >= qty) {
                inv[id] = (inv[id] ?? 0) - qty
                delta[id] = (delta[id] ?? 0) - qty
                satisfied[id] = true
            } else {
                satisfied[id] = false
            }
        }

        // Happiness drifts toward the target computed from this tick's town.
        const target = deriveTown(buildings, happiness, cursor, satisfied).happinessTarget
        if (happiness < target) happiness = Math.min(target, happiness + TOWN_HAPPINESS_DRIFT_PER_TICK)
        else if (happiness > target) happiness = Math.max(target, happiness - TOWN_HAPPINESS_DRIFT_PER_TICK)
        derived = deriveTown(buildings, happiness, cursor, satisfied)
    }

    // Bake finished builds/upgrades into levels so the caller can persist them.
    for (const b of buildings) {
        if (b.completesAt <= now && (b.level === 0 || b.upgradingTo !== null)) {
            const level = b.upgradingTo ?? 1
            b.level = level
            b.upgradingTo = null
            completed.push({ id: b.id, level })
        }
    }

    const cleanDelta: TownResourceBag = {}
    for (const [id, qty] of Object.entries(delta) as [TownResourceId, number][]) {
        if (qty !== 0) cleanDelta[id] = qty
    }

    return {
        happiness,
        tickProgressMs: Math.round(progress),
        lastSettledAt: now,
        delta: cleanDelta,
        ticks,
        completed,
        satisfied
    }
}

/** Coins per day the current layout earns if every output were floor-sold (ignores input consumption elsewhere). */
export function townFloorIncomePerDay(buildings: TownSimBuilding[], happiness: number, now: number): number {
    const derived = deriveTown(buildings, happiness, now)
    const ticksPerDay = (24 * 60 * 60_000) / TOWN_TICK_MS * derived.speedMultiplier
    let perTick = 0
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const def = BUILDING_BY_ID.get(b.type)!
        if (def.kind !== 'industry') continue
        const level = effectiveLevel(b, now)
        const ratio = derived.staffing.get(b.id) ?? 0
        for (const [id, qty] of Object.entries(def.outputs) as [TownResourceId, number][]) {
            perTick += qty * level * ratio * townFloorPrice(id)
        }
        for (const [id, qty] of Object.entries(def.inputs) as [TownResourceId, number][]) {
            perTick -= qty * level * ratio * townFloorPrice(id)
        }
    }
    return Math.max(0, perTick * ticksPerDay)
}

// ─── Market ──────────────────────────────────────────────────────────────────

export function townPriceCents(price: number): number {
    return Math.round(price * 100)
}

export function isValidTownPrice(price: number): boolean {
    if (!Number.isFinite(price) || price < TOWN_MARKET_MIN_PRICE) return false
    if (price * 100 > Number.MAX_SAFE_INTEGER) return false
    return Math.abs(price * 100 - townPriceCents(price)) < 1e-6
}

export function isValidTownQuantity(quantity: number): boolean {
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 2_147_483_647
}

export function townOrderTotal(price: number, quantity: number): number {
    return townPriceCents(price) * quantity / 100
}

// ─── Milestones ──────────────────────────────────────────────────────────────
// One-time coin rewards that double as the tutorial: each one points at the
// next thing worth doing. Conditions are evaluated server-side from a snapshot;
// claiming flips a per-milestone flag (claim-then-reward) before the credit.

export interface TownMilestoneSnapshot {
    /** Completed buildings by type (level >= 1). */
    builtByType: Partial<Record<TownBuildingId, number>>
    maxLevel: number
    popCap: number
    happiness: number
    plotsBought: number
    /** Lifetime coins earned from selling resources (floor + player market). */
    coinsEarned: number
    industryCount: number
}

export interface TownMilestoneDef {
    id: string
    title: string
    description: string
    emoji: string
    reward: number
    /** Ordering / grouping hint. */
    tier: number
    progress: (s: TownMilestoneSnapshot) => { current: number, target: number }
}

function built(type: TownBuildingId, target = 1): TownMilestoneDef['progress'] {
    return s => ({ current: Math.min(target, s.builtByType[type] ?? 0), target })
}

export const TOWN_MILESTONES: readonly TownMilestoneDef[] = [
    { id: 'first-home', title: 'Home Sweet Home', description: 'Build a House.', emoji: '🏠', reward: 500, tier: 0, progress: built('house') },
    { id: 'first-farm', title: 'Breaking Ground', description: 'Build a Farm.', emoji: '🌾', reward: 1_000, tier: 0, progress: built('farm') },
    { id: 'first-sale', title: 'First Sale', description: 'Earn 1,000 coins from selling resources.', emoji: '💰', reward: 2_500, tier: 0, progress: s => ({ current: Math.min(1_000, s.coinsEarned), target: 1_000 }) },
    { id: 'green-thumb', title: 'Green Thumb', description: 'Build a Park.', emoji: '🌳', reward: 3_000, tier: 0, progress: built('park') },
    { id: 'growing', title: 'Growing Pains', description: 'Run 4 industry buildings at once.', emoji: '🏗️', reward: 4_000, tier: 1, progress: s => ({ current: Math.min(4, s.industryCount), target: 4 }) },
    { id: 'neighbourhood', title: 'Neighbourhood', description: 'House 16 residents.', emoji: '👨‍👩‍👧', reward: 5_000, tier: 1, progress: s => ({ current: Math.min(16, s.popCap), target: 16 }) },
    { id: 'level-up', title: 'Level Up', description: 'Upgrade any building to level 3.', emoji: '⬆️', reward: 10_000, tier: 1, progress: s => ({ current: Math.min(3, s.maxLevel), target: 3 }) },
    { id: 'processing', title: 'Processing Power', description: 'Build a Mill or a Sawmill.', emoji: '🪚', reward: 20_000, tier: 2, progress: s => ({ current: Math.min(1, (s.builtByType.mill ?? 0) + (s.builtByType.sawmill ?? 0)), target: 1 }) },
    { id: 'happy-town', title: 'Happy Town', description: 'Reach 75 happiness.', emoji: '😄', reward: 15_000, tier: 2, progress: s => ({ current: Math.min(75, s.happiness), target: 75 }) },
    { id: 'brickworks', title: 'Brickworks', description: 'Build a Brick Kiln.', emoji: '🧱', reward: 30_000, tier: 2, progress: built('kiln') },
    { id: 'land-grab', title: 'Land Grab', description: 'Buy a second plot.', emoji: '🗺️', reward: 100_000, tier: 2, progress: s => ({ current: Math.min(2, s.plotsBought), target: 2 }) },
    { id: 'baker', title: 'Fresh Bread', description: 'Build a Bakery.', emoji: '🍞', reward: 150_000, tier: 3, progress: built('bakery') },
    { id: 'toolmaker', title: 'Toolmaker', description: 'Build a Smithy.', emoji: '🔧', reward: 200_000, tier: 3, progress: built('smithy') },
    { id: 'merchant', title: 'Merchant', description: 'Earn 1M coins from sales.', emoji: '🏪', reward: 250_000, tier: 3, progress: s => ({ current: Math.min(1_000_000, s.coinsEarned), target: 1_000_000 }) },
    { id: 'deep-dig', title: 'Deep Dig', description: 'Build an Iron Mine.', emoji: '⛏️', reward: 1_000_000, tier: 4, progress: built('mine') },
    { id: 'steelworks', title: 'Steelworks', description: 'Build a Foundry.', emoji: '⚙️', reward: 3_000_000, tier: 4, progress: built('foundry') },
    { id: 'maxed', title: 'Perfectionist', description: 'Upgrade any building to level 10.', emoji: '🏅', reward: 2_000_000, tier: 4, progress: s => ({ current: Math.min(10, s.maxLevel), target: 10 }) },
    { id: 'industrialist', title: 'Industrialist', description: 'Build a Factory.', emoji: '🏭', reward: 20_000_000, tier: 5, progress: built('factory') },
    { id: 'tycoon', title: 'Tycoon', description: 'Build an Emporium.', emoji: '💎', reward: 150_000_000, tier: 6, progress: built('emporium') },
    { id: 'magnate', title: 'Magnate', description: 'Earn 100M coins from sales.', emoji: '👑', reward: 10_000_000, tier: 6, progress: s => ({ current: Math.min(100_000_000, s.coinsEarned), target: 100_000_000 }) }
]

const MILESTONE_BY_ID = new Map(TOWN_MILESTONES.map(m => [m.id, m]))

export function getTownMilestone(id: string): TownMilestoneDef | undefined {
    return MILESTONE_BY_ID.get(id)
}

export function townMilestoneSnapshot(buildings: TownSimBuilding[], derived: TownDerived, happiness: number, plotsBought: number, coinsEarned: number, now: number): TownMilestoneSnapshot {
    const builtByType: Partial<Record<TownBuildingId, number>> = {}
    let maxLevel = 0
    let industryCount = 0
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const level = effectiveLevel(b, now)
        builtByType[b.type] = (builtByType[b.type] ?? 0) + 1
        if (level > maxLevel) maxLevel = level
        if (BUILDING_BY_ID.get(b.type)!.kind === 'industry') industryCount++
    }
    return { builtByType, maxLevel, popCap: derived.popCap, happiness, plotsBought, coinsEarned, industryCount }
}

export function townMilestoneComplete(def: TownMilestoneDef, snapshot: TownMilestoneSnapshot): boolean {
    const p = def.progress(snapshot)
    return p.current >= p.target
}
