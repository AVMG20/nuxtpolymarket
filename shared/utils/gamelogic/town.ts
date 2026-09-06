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

/** Second plot waits 10 min after founding; every further plot triples the wait. Prices go 50k, 225k, 1M, 4.5M… — more land is more income, so it is priced like it. */
export const TOWN_PLOT_COOLDOWN_BASE_MS = 10 * 60_000
export const TOWN_PLOT_COOLDOWN_GROWTH = 3
export const TOWN_PLOT_PRICE_BASE = 50_000
export const TOWN_PLOT_PRICE_GROWTH = 4.5
export const TOWN_MAX_PLOTS = 12

/**
 * Every extra copy of the same building costs more: the n-th one (0-based)
 * pays base × TOWN_REPEAT_GROWTH^n in coins and resources. Roads barely climb.
 */
export const TOWN_REPEAT_GROWTH = 1.35
export const TOWN_ROAD_REPEAT_GROWTH = 1.02
/**
 * Per-kind/tier repeat growth. Base prices are set so the FIRST copy pays for
 * itself in ~6–12 days at floor prices; each further copy takes growth× longer.
 * Houses climb hardest — every house unlocks more workers, so more income.
 */
export function townRepeatGrowth(def: TownBuildingDef): number {
    if (def.kind === 'road') return TOWN_ROAD_REPEAT_GROWTH
    if (def.kind === 'housing') return 1.4
    if (def.kind === 'civic' || def.kind === 'storage') return 1.3
    if (def.tier <= 1) return 1.35
    if (def.tier === 2) return 1.4
    if (def.tier === 3) return 1.45
    return 1.5
}
/**
 * Tier N (>= 2) also needs this many residents housed — the pacing lever that
 * turns "build one tier-1 building" into a real town before the next tier.
 */
export const TOWN_TIER_POP_REQUIREMENT: Record<number, number> = { 2: 24, 3: 80, 4: 240, 5: 640, 6: 1600 }
/**
 * …and this many units of the previous tier's goods produced over the town's
 * lifetime. Coins can buy houses; only tiles and time can make goods, so this
 * is what paces a rich mayor. Tuned for roughly: tier 2 in hours, tier 3 in a
 * few days, tier 4 ~2 weeks, tier 5 ~1 month, tier 6 ~3 months.
 */
export const TOWN_TIER_PRODUCTION_REQUIREMENT: Record<number, { tier: number, amount: number }> = {
    2: { tier: 1, amount: 3_000 },
    3: { tier: 2, amount: 20_000 },
    4: { tier: 3, amount: 30_000 },
    5: { tier: 4, amount: 40_000 },
    6: { tier: 5, amount: 20_000 }
}

/** Building level cap and per-level cost growth (coins and resources alike). */
export const TOWN_MAX_BUILDING_LEVEL = 20
// Starter buildings go up in a minute so a new mayor is playing immediately;
// the idle pacing comes from levels (×1.3 each) and from the higher tiers,
// which run for hours and cap at three days.
export const TOWN_LEVEL_COST_GROWTH = 1.35
export const TOWN_LEVEL_TIME_GROWTH = 1.3
/**
 * No single build or upgrade may run longer than this. An idle game wants long
 * timers, but a three-day wall is the point past which a build stops being a
 * plan and starts being a punishment — and rushing it would cost 864 gems.
 */
export const TOWN_MAX_BUILD_MS = 72 * 60 * 60_000

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
/**
 * Parks cheer every house within this Chebyshev radius (3 = a 7×7 square).
 * A road tile always sits between a home and its neighbours, so every radius
 * here is one wider than the raw distance the effect is meant to cover.
 */
export const TOWN_PARK_RADIUS = 3
/** Fallback nuisance radius; the real one is per tier via TOWN_INDUSTRY_NUISANCE. */
export const TOWN_INDUSTRY_RADIUS = 3
export const TOWN_HAPPINESS_PARK_NEARBY = 2
export const TOWN_HAPPINESS_INDUSTRY_ADJACENT = 1
/** Nuisance radius and per-house penalty by building tier (index = tier). */
export const TOWN_INDUSTRY_NUISANCE: readonly { radius: number, penalty: number }[] = [
    { radius: 2, penalty: 1 }, // tier 0 (unused)
    { radius: 3, penalty: 1 }, // farms, lumber, quarry
    { radius: 3, penalty: 1 }, // mill, sawmill, kiln
    { radius: 4, penalty: 2 }, // bakery, smithy
    { radius: 4, penalty: 2 }, // mine, foundry
    { radius: 5, penalty: 3 }, // factory
    { radius: 5, penalty: 3 } // emporium
]
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
    'road',
    'house', 'park', 'warehouse',
    'farm', 'lumber', 'quarry',
    'mill', 'sawmill', 'kiln',
    'bakery', 'smithy',
    'mine', 'foundry',
    'factory',
    'emporium'
] as const
export type TownBuildingId = typeof TOWN_BUILDING_IDS[number]

export type TownBuildingKind = 'road' | 'housing' | 'civic' | 'storage' | 'industry'

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
const HOUR = 60 * MIN

export const TOWN_BUILDINGS: readonly TownBuildingDef[] = [
    {
        id: 'road', name: 'Road', emoji: '🛣️', color: 0x6b6b6b, tier: 0, kind: 'road',
        description: 'Front doors open onto roads. Start at the edge of your land, then extend.',
        cost: { coins: 1_000, resources: {} }, buildMs: 0,
        upgradeResources: {},
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'house', name: 'House', emoji: '🏠', color: 0xe9c46a, tier: 0, kind: 'housing',
        description: 'Homes for your townsfolk. Every industry building needs residents to run.',
        cost: { coins: 40_000, resources: {} }, buildMs: 1 * MIN,
        upgradeResources: { wood: 12 },
        workers: 0, inputs: {}, outputs: {}, popCap: 4, happiness: 0, storage: 0
    },
    {
        id: 'park', name: 'Park', emoji: '🌳', color: 0x52b788, tier: 0, kind: 'civic',
        description: 'Green space. Every house within 3 tiles gets happier — place parks between your homes.',
        cost: { coins: 60_000, resources: { wood: 40 } }, buildMs: 1 * MIN,
        upgradeResources: { wood: 10, stone: 6 },
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 2, storage: 0
    },
    {
        id: 'warehouse', name: 'Warehouse', emoji: '📦', color: 0x8d99ae, tier: 2, kind: 'storage',
        description: 'Raises the storage cap of every resource. Full storage halts production.',
        cost: { coins: 150_000, resources: { planks: 60, bricks: 40 } }, buildMs: 30 * MIN,
        upgradeResources: { planks: 20, bricks: 10 },
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 0, storage: TOWN_WAREHOUSE_STORAGE
    },
    {
        id: 'farm', name: 'Farm', emoji: '🌾', color: 0xd4a373, tier: 1, kind: 'industry',
        description: 'Grows wheat. The simplest way to start earning.',
        cost: { coins: 45_000, resources: {} }, buildMs: 1 * MIN,
        upgradeResources: { wood: 8 },
        workers: 1, inputs: {}, outputs: { wheat: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'lumber', name: 'Lumber Camp', emoji: '🪵', color: 0x6f4e37, tier: 1, kind: 'industry',
        description: 'Fells trees for wood.',
        cost: { coins: 45_000, resources: {} }, buildMs: 1 * MIN,
        upgradeResources: { stone: 8 },
        workers: 1, inputs: {}, outputs: { wood: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'quarry', name: 'Quarry', emoji: '🪨', color: 0x9a8c98, tier: 1, kind: 'industry',
        description: 'Cuts stone from the ground.',
        cost: { coins: 70_000, resources: {} }, buildMs: 2 * MIN,
        upgradeResources: { wood: 10 },
        workers: 1, inputs: {}, outputs: { stone: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'mill', name: 'Mill', emoji: '🌕', color: 0xf4e285, tier: 2, kind: 'industry',
        description: 'Grinds wheat into flour.',
        cost: { coins: 120_000, resources: { wood: 120, stone: 80 } }, buildMs: 45 * MIN,
        upgradeResources: { planks: 12, stone: 8 },
        workers: 2, inputs: { wheat: 2 }, outputs: { flour: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'sawmill', name: 'Sawmill', emoji: '🪚', color: 0xbc6c25, tier: 2, kind: 'industry',
        description: 'Saws wood into planks.',
        cost: { coins: 120_000, resources: { wood: 120, stone: 80 } }, buildMs: 45 * MIN,
        upgradeResources: { planks: 12, stone: 8 },
        workers: 2, inputs: { wood: 2 }, outputs: { planks: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'kiln', name: 'Brick Kiln', emoji: '🧱', color: 0xc1440e, tier: 2, kind: 'industry',
        description: 'Fires stone into bricks.',
        cost: { coins: 200_000, resources: { wood: 150, stone: 120 } }, buildMs: 60 * MIN,
        upgradeResources: { planks: 12, bricks: 8 },
        workers: 2, inputs: { stone: 2 }, outputs: { bricks: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'bakery', name: 'Bakery', emoji: '🍞', color: 0xf77f00, tier: 3, kind: 'industry',
        description: 'Bakes bread. Fed townsfolk are happier, and bread sells well.',
        cost: { coins: 700_000, resources: { planks: 150, bricks: 100, wheat: 300 } }, buildMs: 3 * HOUR,
        upgradeResources: { bricks: 20, tools: 4 },
        workers: 3, inputs: { flour: 2, wood: 1 }, outputs: { bread: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'smithy', name: 'Smithy', emoji: '🔧', color: 0x4a4e69, tier: 3, kind: 'industry',
        description: 'Forges tools from planks and bricks. Tools unlock heavy industry.',
        cost: { coins: 1_000_000, resources: { planks: 200, bricks: 200, stone: 200 } }, buildMs: 4 * HOUR,
        upgradeResources: { bricks: 20, tools: 4 },
        workers: 3, inputs: { planks: 2, bricks: 2 }, outputs: { tools: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'mine', name: 'Iron Mine', emoji: '⛏️', color: 0x3d405b, tier: 4, kind: 'industry',
        description: 'Digs iron ore. Needs tools to build and to keep running.',
        cost: { coins: 1_300_000, resources: { tools: 100, bricks: 400, planks: 300 } }, buildMs: 6 * HOUR,
        upgradeResources: { tools: 20, planks: 40 },
        workers: 4, inputs: { tools: 1 }, outputs: { ore: 3 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'foundry', name: 'Foundry', emoji: '⚙️', color: 0x9d0208, tier: 4, kind: 'industry',
        description: 'Smelts ore into steel.',
        cost: { coins: 7_500_000, resources: { tools: 200, bricks: 800, planks: 400 } }, buildMs: 8 * HOUR,
        upgradeResources: { tools: 30, bricks: 60 },
        workers: 5, inputs: { ore: 3, wood: 2 }, outputs: { steel: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'factory', name: 'Factory', emoji: '🏭', color: 0x577590, tier: 5, kind: 'industry',
        description: 'Assembles machines from steel, planks and tools.',
        cost: { coins: 45_000_000, resources: { steel: 400, tools: 500, bricks: 1000 } }, buildMs: 12 * HOUR,
        upgradeResources: { steel: 40, tools: 40 },
        workers: 8, inputs: { steel: 3, planks: 3, tools: 1 }, outputs: { machines: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'emporium', name: 'Emporium', emoji: '💎', color: 0x7b2cbf, tier: 6, kind: 'industry',
        description: 'Crafts luxuries — the most valuable good a town can produce.',
        cost: { coins: 500_000_000, resources: { machines: 100, steel: 1000, tools: 800, bread: 1000 } }, buildMs: 24 * HOUR,
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

/** Build/upgrade duration in ms for reaching `level`. Pass the town's happiness to apply the mood's build-time perk. */
export function townLevelBuildMs(def: TownBuildingDef, level: number, happiness?: number): number {
    const mood = happiness === undefined ? 1 : townMood(happiness).buildTime
    return Math.min(TOWN_MAX_BUILD_MS, Math.round(def.buildMs * Math.pow(TOWN_LEVEL_TIME_GROWTH, level - 1) * mood))
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
    /** Clockwise quarter turns; decides which tile is the front door. */
    rotation?: number
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

/** Nuisance an industry building projects: how far, and how much per house inside. */
export function townIndustryNuisance(def: TownBuildingDef): { radius: number, penalty: number } {
    if (def.kind !== 'industry') return { radius: 0, penalty: 0 }
    return TOWN_INDUSTRY_NUISANCE[Math.min(def.tier, TOWN_INDUSTRY_NUISANCE.length - 1)]!
}

/** Effect radius (Chebyshev) a building projects onto houses, or 0 for none. */
export function townEffectRadius(def: TownBuildingDef): number {
    if (def.kind === 'civic') return TOWN_PARK_RADIUS
    if (def.kind === 'industry') return townIndustryNuisance(def).radius
    return 0
}

// ─── Roads & facing ──────────────────────────────────────────────────────────
// rotation is clockwise quarter turns; the model's door faces +z (world +y)
// at rotation 0, so FACING[rotation] is the tile a building fronts onto.

export const TOWN_FACING: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]]

export function townFrontTile(wx: number, wy: number, rotation: number): { wx: number, wy: number } {
    const [dx, dy] = TOWN_FACING[((rotation % 4) + 4) % 4]!
    return { wx: wx + dx, wy: wy + dy }
}

/** True on the outer ring of a plot — where a road can meet the outside world. */
export function townIsPlotEdge(wx: number, wy: number): boolean {
    const mx = ((wx % TOWN_PLOT_SIZE) + TOWN_PLOT_SIZE) % TOWN_PLOT_SIZE
    const my = ((wy % TOWN_PLOT_SIZE) + TOWN_PLOT_SIZE) % TOWN_PLOT_SIZE
    return mx === 0 || my === 0 || mx === TOWN_PLOT_SIZE - 1 || my === TOWN_PLOT_SIZE - 1
}

export function townRoadAt(buildings: TownSimBuilding[], wx: number, wy: number): boolean {
    return buildings.some(b => b.type === 'road' && b.wx === wx && b.wy === wy)
}

/** Rotation that faces an adjacent road, preferring the order S, E, N, W — or null if none. */
export function townAutoFacing(buildings: TownSimBuilding[], wx: number, wy: number): number | null {
    for (let r = 0; r < 4; r++) {
        const f = townFrontTile(wx, wy, r)
        if (townRoadAt(buildings, f.wx, f.wy)) return r
    }
    return null
}

/**
 * Why a building cannot go on (wx, wy) facing `rotation`, or null if it can.
 * Shared by the client (ghost colour) and the server (the real check).
 */
export function townPlacementIssue(buildings: TownSimBuilding[], def: TownBuildingDef, wx: number, wy: number, rotation: number): string | null {
    if (buildings.some(b => b.wx === wx && b.wy === wy)) return 'That tile is already taken'
    if (def.kind === 'road') {
        const touchesRoad = TOWN_FACING.some(([dx, dy]) => townRoadAt(buildings, wx + dx, wy + dy))
        if (!touchesRoad && !townIsPlotEdge(wx, wy)) return 'Roads must start at the edge of your land or continue another road'
        return null
    }
    const front = townFrontTile(wx, wy, rotation)
    if (!townRoadAt(buildings, front.wx, front.wy)) return 'Needs a road at its front door — rotate with R or build a road first'
    return null
}

/**
 * Does this building have a road at its front door? Roads always do; buildings
 * without world coordinates (unit tests, legacy rows) are treated as connected.
 * A disconnected building is dead weight: no residents, no workers, no output.
 */
export function townRoadAccess(buildings: TownSimBuilding[], b: TownSimBuilding): boolean {
    if (b.type === 'road') return true
    if (b.wx === undefined || b.wy === undefined) return true
    const f = townFrontTile(b.wx, b.wy, b.rotation ?? 0)
    return townRoadAt(buildings, f.wx, f.wy)
}

/** Buildings whose front door opens onto (wx, wy) — what removing that road would cut off. */
export function townBuildingsFronting(buildings: TownSimBuilding[], wx: number, wy: number): TownSimBuilding[] {
    return buildings.filter((b) => {
        if (b.type === 'road' || b.wx === undefined || b.wy === undefined) return false
        const f = townFrontTile(b.wx, b.wy, b.rotation ?? 0)
        return f.wx === wx && f.wy === wy
    })
}

/**
 * What the n-th copy of a building costs (existing = how many of that type the
 * town already has, finished or not). Coins and resources both climb.
 */
export function townPlaceCost(def: TownBuildingDef, existing: number): { coins: number, resources: TownResourceBag } {
    const factor = Math.pow(townRepeatGrowth(def), Math.max(0, existing))
    return {
        coins: Math.round(def.cost.coins * factor),
        resources: scaleBag(def.cost.resources, factor)
    }
}

/** Houses within `radius` of a tile — what an industry building would sour, or a park cheer. */
export function townHousesWithin(buildings: TownSimBuilding[], wx: number, wy: number, radius: number, now = Date.now()): number {
    let n = 0
    for (const b of buildings) {
        if (b.type !== 'house' || !isBuilt(b, now)) continue
        if (within(b, wx, wy, radius)) n++
    }
    return n
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
        const { parks, industryPenalty } = houseAdjacency(buildings, b.wx, b.wy, Infinity)
        total += parks * TOWN_HAPPINESS_PARK_NEARBY - industryPenalty
    }
    return Math.max(-TOWN_HAPPINESS_LAYOUT_CAP, Math.min(TOWN_HAPPINESS_LAYOUT_CAP, total))
}

/**
 * What a house on `wx,wy` gets from its surroundings (built buildings only):
 * parks in reach, industry buildings whose nuisance radius covers it, and the
 * summed penalty those inflict.
 */
export function houseAdjacency(buildings: TownSimBuilding[], wx: number, wy: number, now = Date.now()): { parks: number, industry: number, industryPenalty: number } {
    let parks = 0
    let industry = 0
    let industryPenalty = 0
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const def = BUILDING_BY_ID.get(b.type)!
        if (def.kind === 'civic' && within(b, wx, wy, TOWN_PARK_RADIUS)) {
            parks++
        } else if (def.kind === 'industry') {
            const { radius, penalty } = townIndustryNuisance(def)
            if (within(b, wx, wy, radius)) {
                industry++
                industryPenalty += penalty * TOWN_HAPPINESS_INDUSTRY_ADJACENT
            }
        }
    }
    return { parks, industry, industryPenalty }
}

/**
 * Tier N buildings (N >= 2) unlock once any tier N-1 building has finished
 * construction — buying your way up the chain through the ceiling market is
 * not a shortcut past actually running the previous tier.
 */
export function townTierUnlocked(buildings: TownSimBuilding[], tier: number, now: number, produced: TownResourceBag = {}): boolean {
    return townTierRequirement(buildings, tier, now, produced) === null
}

export interface TownTierLock {
    needsBuilding: boolean
    pop: number
    popRequired: number
    /** Lifetime units of the gating tier's goods made so far, and the target. */
    produced: number
    producedRequired: number
    producedTier: number
}

/** Lifetime production of every resource of `tier`. */
export function townProducedOfTier(produced: TownResourceBag, tier: number): number {
    let total = 0
    for (const r of TOWN_RESOURCES) if (r.tier === tier) total += produced[r.id] ?? 0
    return total
}

/** Why a tier is still locked, or null when it is open. */
export function townTierRequirement(buildings: TownSimBuilding[], tier: number, now: number, produced: TownResourceBag = {}): TownTierLock | null {
    if (tier <= 1) return null
    const hasPrevious = buildings.some(b => isBuilt(b, now) && BUILDING_BY_ID.get(b.type)!.tier === tier - 1)
    let pop = 0
    for (const b of buildings) {
        if (!isBuilt(b, now) || !townRoadAccess(buildings, b)) continue
        const def = BUILDING_BY_ID.get(b.type)!
        pop += def.popCap * effectiveLevel(b, now)
    }
    const popRequired = TOWN_TIER_POP_REQUIREMENT[tier] ?? 0
    const req = TOWN_TIER_PRODUCTION_REQUIREMENT[tier]
    const producedTier = req?.tier ?? tier - 1
    const producedRequired = req?.amount ?? 0
    const made = townProducedOfTier(produced, producedTier)
    if (hasPrevious && pop >= popRequired && made >= producedRequired) return null
    return { needsBuilding: !hasPrevious, pop, popRequired, produced: made, producedRequired, producedTier }
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

/**
 * Happiness is a ladder of moods, each with visible perks: production speed,
 * build time, storage. Clear steps read better than a smooth curve — the
 * player can see the next threshold and what it buys.
 */
export interface TownMood {
    id: string
    name: string
    emoji: string
    /** Inclusive lower bound of happiness for this mood. */
    min: number
    /** Production speed multiplier applied to every tick. */
    speed: number
    /** Multiplier on build and upgrade durations. */
    buildTime: number
    /** Multiplier on the storage cap. */
    storage: number
}

export const TOWN_MOODS: readonly TownMood[] = [
    { id: 'miserable', name: 'Miserable', emoji: '😠', min: 0, speed: 0.5, buildTime: 1.25, storage: 1 },
    { id: 'uneasy', name: 'Uneasy', emoji: '😐', min: 25, speed: 0.75, buildTime: 1.1, storage: 1 },
    { id: 'content', name: 'Content', emoji: '🙂', min: 50, speed: 1, buildTime: 1, storage: 1 },
    { id: 'happy', name: 'Happy', emoji: '😄', min: 75, speed: 1.15, buildTime: 0.9, storage: 1.1 },
    { id: 'thriving', name: 'Thriving', emoji: '🤩', min: 90, speed: 1.3, buildTime: 0.8, storage: 1.25 }
]

export function townMood(happiness: number): TownMood {
    const h = Math.max(0, Math.min(100, happiness))
    let mood = TOWN_MOODS[0]!
    for (const m of TOWN_MOODS) if (h >= m.min) mood = m
    return mood
}

export function townNextMood(happiness: number): TownMood | null {
    const h = Math.max(0, Math.min(100, happiness))
    return TOWN_MOODS.find(m => m.min > h) ?? null
}

export function townSpeedMultiplier(happiness: number): number {
    return townMood(happiness).speed
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
        .filter(b => isBuilt(b, now) && townRoadAccess(buildings, b))
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
    storageCap = Math.round(storageCap * townMood(happiness).storage)

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
    /** Coins paid on claim. Only the late goals pay coins — at this site's scale anything under 10M is noise. */
    reward: number
    /**
     * Gems paid on claim. Gems are the site's scarce currency — a whole town,
     * played to the end, pays out well under a day's worth of other games.
     */
    gems?: number
    /** Ordering / grouping hint. */
    tier: number
    progress: (s: TownMilestoneSnapshot) => { current: number, target: number }
}

function built(type: TownBuildingId, target = 1): TownMilestoneDef['progress'] {
    return s => ({ current: Math.min(target, s.builtByType[type] ?? 0), target })
}

export const TOWN_MILESTONES: readonly TownMilestoneDef[] = [
    { id: 'first-home', title: 'Home Sweet Home', description: 'Build a House.', emoji: '🏠', reward: 0, gems: 1, tier: 0, progress: built('house') },
    { id: 'first-farm', title: 'Breaking Ground', description: 'Build a Farm.', emoji: '🌾', reward: 0, gems: 1, tier: 0, progress: built('farm') },
    { id: 'first-sale', title: 'First Sale', description: 'Earn 1,000 coins from selling resources.', emoji: '💰', reward: 0, gems: 1, tier: 0, progress: s => ({ current: Math.min(1_000, s.coinsEarned), target: 1_000 }) },
    { id: 'green-thumb', title: 'Green Thumb', description: 'Build a Park.', emoji: '🌳', reward: 0, gems: 1, tier: 0, progress: built('park') },
    { id: 'growing', title: 'Growing Pains', description: 'Run 4 industry buildings at once.', emoji: '🏗️', reward: 0, gems: 1, tier: 1, progress: s => ({ current: Math.min(4, s.industryCount), target: 4 }) },
    { id: 'neighbourhood', title: 'Neighbourhood', description: 'House 16 residents.', emoji: '👨‍👩‍👧', reward: 0, gems: 2, tier: 1, progress: s => ({ current: Math.min(16, s.popCap), target: 16 }) },
    { id: 'level-up', title: 'Level Up', description: 'Upgrade any building to level 3.', emoji: '⬆️', reward: 0, gems: 2, tier: 1, progress: s => ({ current: Math.min(3, s.maxLevel), target: 3 }) },
    { id: 'processing', title: 'Processing Power', description: 'Build a Mill or a Sawmill.', emoji: '🪚', reward: 0, gems: 3, tier: 2, progress: s => ({ current: Math.min(1, (s.builtByType.mill ?? 0) + (s.builtByType.sawmill ?? 0)), target: 1 }) },
    { id: 'happy-town', title: 'Happy Town', description: 'Reach 75 happiness.', emoji: '😄', reward: 0, gems: 3, tier: 2, progress: s => ({ current: Math.min(75, s.happiness), target: 75 }) },
    { id: 'brickworks', title: 'Brickworks', description: 'Build a Brick Kiln.', emoji: '🧱', reward: 0, gems: 3, tier: 2, progress: built('kiln') },
    { id: 'land-grab', title: 'Land Grab', description: 'Buy a second plot.', emoji: '🗺️', reward: 0, gems: 5, tier: 2, progress: s => ({ current: Math.min(2, s.plotsBought), target: 2 }) },
    { id: 'baker', title: 'Fresh Bread', description: 'Build a Bakery.', emoji: '🍞', reward: 0, gems: 6, tier: 3, progress: built('bakery') },
    { id: 'toolmaker', title: 'Toolmaker', description: 'Build a Smithy.', emoji: '🔧', reward: 0, gems: 6, tier: 3, progress: built('smithy') },
    { id: 'merchant', title: 'Merchant', description: 'Earn 1M coins from sales.', emoji: '🏪', reward: 0, gems: 8, tier: 3, progress: s => ({ current: Math.min(1_000_000, s.coinsEarned), target: 1_000_000 }) },
    { id: 'deep-dig', title: 'Deep Dig', description: 'Build an Iron Mine.', emoji: '⛏️', reward: 0, gems: 10, tier: 4, progress: built('mine') },
    { id: 'steelworks', title: 'Steelworks', description: 'Build a Foundry.', emoji: '⚙️', reward: 0, gems: 12, tier: 4, progress: built('foundry') },
    { id: 'maxed', title: 'Perfectionist', description: 'Upgrade any building to level 10.', emoji: '🏅', reward: 0, gems: 10, tier: 4, progress: s => ({ current: Math.min(10, s.maxLevel), target: 10 }) },
    { id: 'industrialist', title: 'Industrialist', description: 'Build a Factory.', emoji: '🏭', reward: 20_000_000, gems: 20, tier: 5, progress: built('factory') },
    { id: 'tycoon', title: 'Tycoon', description: 'Build an Emporium.', emoji: '💎', reward: 150_000_000, gems: 40, tier: 6, progress: built('emporium') },
    { id: 'magnate', title: 'Magnate', description: 'Earn 100M coins from sales.', emoji: '👑', reward: 10_000_000, gems: 25, tier: 6, progress: s => ({ current: Math.min(100_000_000, s.coinsEarned), target: 100_000_000 }) }
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
