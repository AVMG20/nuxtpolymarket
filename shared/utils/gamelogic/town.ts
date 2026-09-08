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

/**
 * How long the land office makes you wait for each plot after the free one.
 *
 * Being short of land IS the early game: it is what forces the choice between
 * a house and a workshop, and what makes the tiles you have worth arranging.
 * A geometric curve got that backwards — the first extra plots arrived within
 * the hour, so the squeeze was over before it started, while the last ones sat
 * behind waits of a year and more that nobody would ever reach.
 *
 * A flat ramp does the job better. Four hours before a second plot, a day
 * before a third, then one more day each time, topping out at ten. Twelve
 * plots is about eight weeks of waiting in total, which sits inside the same
 * window as growing a town to the top tiers.
 */
const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS
export const TOWN_PLOT_COOLDOWNS_MS: readonly number[] = [
    4 * HOUR_MS, // plot 2
    1 * DAY_MS, // plot 3
    2 * DAY_MS,
    3 * DAY_MS,
    4 * DAY_MS,
    5 * DAY_MS,
    6 * DAY_MS,
    7 * DAY_MS,
    8 * DAY_MS,
    9 * DAY_MS,
    10 * DAY_MS // plot 12
]
export const TOWN_PLOT_PRICE_BASE = 50_000
export const TOWN_PLOT_PRICE_GROWTH = 4.5
export const TOWN_MAX_PLOTS = 12
/**
 * One shared realm: a new town is planted so that at least this many EMPTY
 * plots sit between it and anyone else's land in every direction, diagonals
 * included (the distance is Chebyshev, see townPlotDistance). With two, the
 * nearest neighbour is three squares away and the two towns span four. Enough
 * room to grow into before you meet anybody, close enough that the land
 * between you is worth buying.
 */
export const TOWN_FOUNDING_GAP = 2
/** Selling a plot back to the land office returns this share of what that plot cost. */
export const TOWN_PLOT_REFUND_SHARE = 0.25
/** Bounds on what a player may ask for a plot. */
export const TOWN_PLOT_MIN_LIST_PRICE = 1
export const TOWN_PLOT_MAX_LIST_PRICE = 1_000_000_000_000

/**
 * What the land office pays to take a plot back: a share of what the office
 * itself was paid for it, which is zero for a plot that changed hands between
 * players or was granted on founding.
 *
 * Both halves of that matter. Deriving the refund from the plot COUNT would let
 * a player buy a cheap plot off a neighbour and sell it back at the price of
 * their next office plot. Deriving it from whatever the last buyer paid ANOTHER
 * PLAYER is worse: two accounts could pass one plot back and forth at a made-up
 * price and mint a quarter of it every round, because the coins between them
 * are zero-sum but the refund is new money.
 */
export function townPlotRefundFor(paidPrice: number): number {
    return Math.floor(Math.max(0, paidPrice) * TOWN_PLOT_REFUND_SHARE)
}

export function isValidTownListPrice(price: number): boolean {
    return Number.isFinite(price)
        && price >= TOWN_PLOT_MIN_LIST_PRICE
        && price <= TOWN_PLOT_MAX_LIST_PRICE
        && Math.abs(price * 100 - Math.round(price * 100)) < 1e-6
}

/** Chebyshev distance in plots — the spacing rule the realm is laid out on. */
export function townPlotDistance(a: { x: number, y: number }, b: { x: number, y: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

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
 * is what paces a rich mayor. Measured against a town running four buildings
 * of the gating tier: tier 2 in hours, tier 3 in ~3 days, tier 4 in ~1 week,
 * tier 5 in ~2 weeks and tier 6 in ~6 weeks on top of everything before it,
 * which puts a first Emporium near the three-month mark.
 */
export const TOWN_TIER_PRODUCTION_REQUIREMENT: Record<number, { tier: number, amount: number }> = {
    2: { tier: 1, amount: 5_000 },
    3: { tier: 2, amount: 250_000 },
    4: { tier: 3, amount: 400_000 },
    5: { tier: 4, amount: 2_000_000 },
    6: { tier: 5, amount: 600_000 }
}

/**
 * Growing a building past a certain size needs goods from further up the
 * chain, whatever the building is: a house reaches level 2 on timber alone,
 * but level 3 wants planks, level 9 tools, level 13 steel, level 17 machines
 * and the last level luxuries. Nothing reaches 20 until the whole chain runs,
 * so a tier-1 building can never be rushed to the cap on raw materials.
 *
 * `base` is the level-5-equivalent amount for a tier-1 building; bigger
 * buildings need proportionally more, and the amount climbs with the level the
 * same way every other cost does.
 */
export const TOWN_UPGRADE_BANDS: readonly { minLevel: number, resource: TownResourceId, base: number }[] = [
    { minLevel: 3, resource: 'planks', base: 12 },
    { minLevel: 9, resource: 'tools', base: 10 },
    { minLevel: 13, resource: 'steel', base: 8 },
    { minLevel: 17, resource: 'machines', base: 4 },
    { minLevel: 20, resource: 'luxuries', base: 5 }
]
/** How much more of a band good a higher-tier building needs per tier. */
export const TOWN_UPGRADE_BAND_TIER_SCALE = 0.4

/** Building level cap and per-level coin growth. */
export const TOWN_MAX_BUILDING_LEVEL = 20
/**
 * A few buildings stop short of the cap because there is nothing left to gain
 * from growing them. The model gains a new look every four levels, so any cap
 * sits on one of those boundaries and a maxed building still shows its final
 * form rather than a half-finished one.
 */
export const TOWN_LEVEL_VISUAL_STEP = 4
/**
 * Goods climb faster than coins do. Coins are the easy half for a mayor who
 * earns elsewhere on the site; the goods are what the town has to make for
 * itself, so they are the real cost of a high level and the reason a big town
 * has to choose between selling its surplus and reinvesting it.
 */
export const TOWN_LEVEL_RESOURCE_GROWTH = 1.42
// Starter buildings go up in a minute so a new mayor is playing immediately;
// the idle pacing comes from levels (×1.3 each) and from the higher tiers,
// which run for hours and cap at three days.
// Coins climb gently. The entry price of a tier is the real coin decision; at
// the old 1.35 a single maxed Emporium cost a trillion on its own and the
// endgame became a coin problem instead of a production one. Goods carry the
// weight instead — see TOWN_LEVEL_RESOURCE_GROWTH, which is much steeper.
export const TOWN_LEVEL_COST_GROWTH = 1.20
/**
 * Putting a building up is quick; growing it is the idle part. The first build
 * uses `buildMs`, every upgrade starts from `upgradeMs` and takes 40% longer
 * than the one before, so a level-20 anything sits at the three-day wall.
 */
export const TOWN_LEVEL_TIME_GROWTH = 1.4
/**
 * No single build or upgrade may run longer than this. An idle game wants long
 * timers, but a three-day wall is the point past which a build stops being a
 * plan and starts being a punishment — and rushing it would cost 864 gems.
 */
export const TOWN_MAX_BUILD_MS = 72 * 60 * 60_000
/**
 * The wall is per tier, so the game paces the way an idle game should: the
 * first two tiers stay brisk even at high levels, the middle tiers settle into
 * half-day and day-long jobs, and only the last two tiers reach the two- and
 * three-day walls. A player checking in twice a day always has something finishing early
 * on, and late-game towns grow on their own for days at a time.
 */
export const TOWN_MAX_BUILD_MS_BY_TIER: Record<number, number> = {
    0: 6 * 60 * 60_000,
    1: 8 * 60 * 60_000,
    2: 12 * 60 * 60_000,
    3: 18 * 60 * 60_000,
    4: 28 * 60 * 60_000,
    5: 54 * 60 * 60_000,
    6: 72 * 60 * 60_000
}

/** The longest a single build or upgrade of `def` may run. */
export function townMaxBuildMs(def: { tier: number }): number {
    return TOWN_MAX_BUILD_MS_BY_TIER[def.tier] ?? TOWN_MAX_BUILD_MS
}

/**
 * Happiness is a running score out of 100 that the town drifts toward.
 * Everything below is a line on that score, so the popover can show exactly
 * where the points came from:
 *
 *   base                              55
 *   + every need the town supplies    up to +15
 *   − every need it could supply and does not
 *   + parks, by share of residents covered   up to +20
 *   − industry, by residents × how dirty it is   down to −25
 *   − overcrowding, − starvation
 *
 * A tidy tier-1 town with grain and parks lands around 72 (Content) with no
 * penalties; the last 30 points come from the goods only later tiers unlock.
 */
export const TOWN_HAPPINESS_START = 50
export const TOWN_HAPPINESS_BASE_TARGET = 55
export const TOWN_HAPPINESS_DRIFT_PER_TICK = 2
export const TOWN_HAPPINESS_CROWDING_PENALTY = 10
export const TOWN_HAPPINESS_CROWDING_RATIO = 1
/** Full park coverage is worth this; half the residents covered is worth half. */
export const TOWN_PARK_MAX_BONUS = 20
/** Industry near homes, weighted by residents affected and by how dirty it is. */
export const TOWN_INDUSTRY_MAX_PENALTY = 25
export const TOWN_INDUSTRY_PENALTY_SCALE = 4
/** Penalty when the town has no food at all (neither wheat nor bread was eaten this tick). */
export const TOWN_HAPPINESS_STARVING_PENALTY = 12
/**
 * Parks cheer every house within this Chebyshev radius (4 = a 9×9 square).
 * A road tile always sits between a home and its neighbours, so every radius
 * here is one wider than the raw distance the effect is meant to cover.
 */
export const TOWN_PARK_RADIUS = 4
/**
 * Nuisance radius and per-house penalty by building tier (index = tier).
 *
 * A plot is 8 tiles across, so any radius below that is solved forever the
 * moment a mayor owns a second plot: put the houses on one and the workshops
 * on the other and the penalty is zero at every tier, for good. Tier 3 costs
 * most of a plot of distance, tier 4 more than a whole one, tier 6 nearly two —
 * heavy
 * industry has to be pushed genuinely far away, and the land to do it with is
 * the thing you spend. The penalty climbs faster than the radius so a factory
 * is unpleasant rather than merely inconvenient.
 */
export const TOWN_INDUSTRY_NUISANCE: readonly { radius: number, penalty: number }[] = [
    { radius: 2, penalty: 1 }, // tier 0 (unused)
    { radius: 3, penalty: 1 }, // farms, lumber, quarry — still fits inside one plot
    { radius: 4, penalty: 2 }, // mill, sawmill, kiln
    { radius: 6, penalty: 3 }, // bakery, smithy — most of a plot of distance
    { radius: 8, penalty: 5 }, // mine, foundry — more than a whole plot
    { radius: 11, penalty: 8 }, // factory
    { radius: 13, penalty: 10 } // emporium — nearly two plots clear, or live with it
]
/** Welcome-back summary is shown for absences at least this long. */
export const TOWN_WELCOME_BACK_MIN_MS = 5 * 60_000

/** Player offers may not exceed this multiple of the floor. The system never sells — only players do. */
export const TOWN_CEILING_MULTIPLIER = 10
/**
 * The most a player order may ask. Not a balance lever — the book has no
 * ceiling by design — just a guard against a typo resting on the book forever
 * at a price no town could ever pay.
 */
export const TOWN_MAX_ORDER_PRICE = 1_000_000_000
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

/**
 * Floor prices set what the whole game is worth, so they are the balance lever
 * of last resort. Polytown costs far more to invest in than the other idle
 * games on the site — hundreds of billions of coins and months of build
 * timers — so it is meant to out-earn them once it is built, and to earn less
 * than them while it is still going up. The low tiers are priced generously
 * relative to the top so that a young town is not earning pocket change for
 * its first month; the ladder from wheat to luxuries is still three thousand
 * to one, which is what keeps climbing tiers worth doing.
 */
export const TOWN_RESOURCES: readonly TownResourceDef[] = [
    { id: 'wheat', name: 'Wheat', emoji: '🌾', tier: 1, floorPrice: 30 },
    { id: 'wood', name: 'Wood', emoji: '🪵', tier: 1, floorPrice: 30 },
    { id: 'stone', name: 'Stone', emoji: '🪨', tier: 1, floorPrice: 48 },
    { id: 'flour', name: 'Flour', emoji: '🌕', tier: 2, floorPrice: 121 },
    { id: 'planks', name: 'Planks', emoji: '🪚', tier: 2, floorPrice: 121 },
    { id: 'bricks', name: 'Bricks', emoji: '🧱', tier: 2, floorPrice: 198 },
    { id: 'bread', name: 'Bread', emoji: '🍞', tier: 3, floorPrice: 550 },
    { id: 'tools', name: 'Tools', emoji: '🔧', tier: 3, floorPrice: 1_000 },
    { id: 'ore', name: 'Iron Ore', emoji: '⛏️', tier: 4, floorPrice: 400 },
    { id: 'steel', name: 'Steel', emoji: '⚙️', tier: 4, floorPrice: 3_600 },
    { id: 'machines', name: 'Machines', emoji: '🏭', tier: 5, floorPrice: 16_500 },
    { id: 'luxuries', name: 'Luxuries', emoji: '💎', tier: 6, floorPrice: 100_000 }
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
    { resource: 'bricks', name: 'Bricks', perPop: 60, minPop: 12, happiness: 2, food: false, description: 'Homes wear out. A town that keeps bricks on hand keeps its streets in good order.' },
    { resource: 'bread', name: 'Bread', perPop: 24, minPop: 16, happiness: 4, food: true, description: 'A proper meal. Worth more than grain alone.' },
    { resource: 'tools', name: 'Tools', perPop: 40, minPop: 40, happiness: 3, food: false, description: 'Workers wear tools out. Keep a stock and they work happier.' },
    { resource: 'luxuries', name: 'Luxuries', perPop: 160, minPop: 120, happiness: 6, food: false, description: 'The finer things. A luxury town is a delighted town.' }
]

/**
 * Units of each need the whole town wants per tick at `pop` residents. A need
 * the town cannot make yet is not demanded at all, so a tier-1 town neither
 * eats bread nor shows a bread deficit in the resource rail.
 */
export function townNeedsPerTick(pop: number, reachableTier = 99): Partial<Record<TownResourceId, number>> {
    const out: Partial<Record<TownResourceId, number>> = {}
    if (pop <= 0) return out
    for (const n of TOWN_NEEDS) {
        if (!townNeedExpected(n, pop, reachableTier)) continue
        out[n.resource] = Math.max(1, Math.ceil(pop / n.perPop))
    }
    return out
}

export type TownSatisfied = Partial<Record<TownResourceId, boolean>>

/**
 * Whether the town is expected to keep this need supplied. A need it cannot
 * produce yet is simply not on the scorecard — no bonus, no penalty — so a
 * tier-1 town is not marked down for having no bread. The moment the tier that
 * makes it is within reach, a missing need starts costing points.
 */
export function townNeedExpected(need: TownNeedDef, pop: number, reachableTier: number): boolean {
    return pop >= need.minPop && (getTownResource(need.resource)?.tier ?? 99) <= reachableTier
}

/**
 * The highest resource tier the town can actually stock: the best building it
 * has FINISHED, never one beyond. Being able to build a mill does not mean you
 * can bake bread, so a town without a bakery is not marked down for having no
 * bread — the moment it builds one, bread starts counting.
 *
 * Floored at 1 so grain is always on the scorecard: people with no farm are
 * genuinely going hungry.
 */
export function townReachableTier(buildings: TownSimBuilding[], now: number): number {
    let best = 1
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const tier = BUILDING_BY_ID.get(b.type)!.tier
        if (tier > best) best = tier
    }
    return best
}

export function needsHappiness(satisfied: TownSatisfied, pop: number, reachableTier = 99): number {
    if (pop <= 0) return 0
    let total = 0
    let anyFoodExpected = false
    let fed = false
    for (const n of TOWN_NEEDS) {
        if (satisfied[n.resource]) {
            // Bought or produced, it counts either way.
            total += n.happiness
            if (n.food) fed = true
            continue
        }
        if (!townNeedExpected(n, pop, reachableTier)) continue
        total -= n.happiness
        if (n.food) anyFoodExpected = true
    }
    if (anyFoodExpected && !fed) total -= TOWN_HAPPINESS_STARVING_PENALTY
    return total
}

// ─── Buildings ───────────────────────────────────────────────────────────────

export const TOWN_BUILDING_IDS = [
    'road',
    'house', 'park', 'warehouse',
    'bathhouse', 'theatre',
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
    /**
     * Residents each level past the first adds. Defaults to `workers`, which
     * is the ordinary "workers × level" shape. A warehouse sets it lower: it
     * wants a couple of hands to open and then only one more per extension,
     * so extending the one you have beats putting up another.
     */
    workersPerLevel?: number
    /** Highest level this building can reach, when lower than the global cap. Always a multiple of four so the model lands on a finished look. */
    maxLevel?: number
    /** Level-1 build cost. Later levels scale coins by TOWN_LEVEL_COST_GROWTH and goods by the steeper TOWN_LEVEL_RESOURCE_GROWTH. */
    cost: { coins: number, resources: TownResourceBag }
    /** Extra resources every upgrade (level >= 2) needs, scaled like the rest of the cost. Puts goods back into the town. */
    upgradeResources: TownResourceBag
    /** Time to put the building up in the first place. */
    buildMs: number
    /** Time for the level 1 → 2 upgrade; every later level multiplies by TOWN_LEVEL_TIME_GROWTH. */
    upgradeMs: number
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
        cost: { coins: 1_000, resources: {} }, buildMs: 0, upgradeMs: 0,
        upgradeResources: {},
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'house', name: 'House', emoji: '🏠', color: 0xe9c46a, tier: 0, kind: 'housing',
        description: 'Two residents per level. Every industry building needs residents to run.',
        cost: { coins: 40_000, resources: {} }, buildMs: 1 * MIN, upgradeMs: 10 * MIN,
        upgradeResources: { wood: 60, stone: 20 },
        workers: 0, inputs: {}, outputs: {}, popCap: 2, happiness: 0, storage: 0
    },
    {
        id: 'park', name: 'Park', emoji: '🌳', color: 0x52b788, tier: 0, kind: 'civic',
        description: 'Green space. Every house within 4 tiles gets happier — place parks between your homes.',
        maxLevel: 12,
        cost: { coins: 60_000, resources: { wood: 80 } }, buildMs: 1 * MIN, upgradeMs: 10 * MIN,
        upgradeResources: { wood: 50, stone: 30 },
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 2, storage: 0
    },
    {
        id: 'bathhouse', name: 'Bathhouse', emoji: '🛁', color: 0x64b6d8, tier: 4, kind: 'civic',
        description: 'Hot water and clean streets. Every home within 4 tiles is happier for it.',
        maxLevel: 8,
        cost: { coins: 3_000_000, resources: { bricks: 600, steel: 80 } }, buildMs: 4 * HOUR, upgradeMs: 10 * HOUR,
        upgradeResources: { bricks: 200, steel: 40 },
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 4, storage: 0
    },
    {
        id: 'theatre', name: 'Theatre', emoji: '🎭', color: 0xa64d9c, tier: 5, kind: 'civic',
        description: 'Somewhere to spend an evening. Worth more happiness than anything else the town can build.',
        maxLevel: 8,
        cost: { coins: 30_000_000, resources: { machines: 40, steel: 400, bricks: 1_200 } }, buildMs: 8 * HOUR, upgradeMs: 20 * HOUR,
        upgradeResources: { machines: 15, steel: 150 },
        workers: 0, inputs: {}, outputs: {}, popCap: 0, happiness: 7, storage: 0
    },
    {
        id: 'warehouse', name: 'Warehouse', emoji: '📦', color: 0x8d99ae, tier: 2, kind: 'storage',
        description: 'Raises the storage cap of every resource. Needs hands to run, and holds only what its crew can manage.',
        maxLevel: 16,
        // Two to open, one more per extension: extending the warehouse you have
        // costs fewer residents than putting up a second one.
        workersPerLevel: 1,
        cost: { coins: 150_000, resources: { planks: 60, bricks: 40 } }, buildMs: 30 * MIN, upgradeMs: 30 * MIN,
        upgradeResources: { planks: 80, bricks: 40 },
        workers: 2, inputs: {}, outputs: {}, popCap: 0, happiness: 0, storage: TOWN_WAREHOUSE_STORAGE
    },
    {
        id: 'farm', name: 'Farm', emoji: '🌾', color: 0xd4a373, tier: 1, kind: 'industry',
        description: 'Grows wheat. The simplest way to start earning.',
        cost: { coins: 45_000, resources: { wood: 20 } }, buildMs: 1 * MIN, upgradeMs: 8 * MIN,
        upgradeResources: { wood: 40 },
        workers: 1, inputs: {}, outputs: { wheat: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'lumber', name: 'Lumber Camp', emoji: '🪵', color: 0x6f4e37, tier: 1, kind: 'industry',
        description: 'Fells trees for wood.',
        cost: { coins: 45_000, resources: {} }, buildMs: 1 * MIN, upgradeMs: 8 * MIN,
        upgradeResources: { stone: 40 },
        workers: 1, inputs: {}, outputs: { wood: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'quarry', name: 'Quarry', emoji: '🪨', color: 0x9a8c98, tier: 1, kind: 'industry',
        description: 'Cuts stone from the ground.',
        cost: { coins: 70_000, resources: { wood: 40 } }, buildMs: 2 * MIN, upgradeMs: 10 * MIN,
        upgradeResources: { wood: 50 },
        workers: 1, inputs: {}, outputs: { stone: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'mill', name: 'Mill', emoji: '🌕', color: 0xf4e285, tier: 2, kind: 'industry',
        description: 'Grinds wheat into flour.',
        cost: { coins: 160_000, resources: { wood: 120, stone: 80 } }, buildMs: 30 * MIN, upgradeMs: 25 * MIN,
        upgradeResources: { planks: 50, stone: 40 },
        workers: 2, inputs: { wheat: 2 }, outputs: { flour: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'sawmill', name: 'Sawmill', emoji: '🪚', color: 0xbc6c25, tier: 2, kind: 'industry',
        description: 'Saws wood into planks.',
        cost: { coins: 160_000, resources: { wood: 120, stone: 80 } }, buildMs: 30 * MIN, upgradeMs: 25 * MIN,
        upgradeResources: { planks: 50, stone: 40 },
        workers: 2, inputs: { wood: 2 }, outputs: { planks: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'kiln', name: 'Brick Kiln', emoji: '🧱', color: 0xc1440e, tier: 2, kind: 'industry',
        description: 'Fires stone into bricks.',
        cost: { coins: 260_000, resources: { wood: 150, stone: 120 } }, buildMs: 40 * MIN, upgradeMs: 30 * MIN,
        upgradeResources: { planks: 50, bricks: 40 },
        workers: 2, inputs: { stone: 2 }, outputs: { bricks: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'bakery', name: 'Bakery', emoji: '🍞', color: 0xf77f00, tier: 3, kind: 'industry',
        description: 'Bakes bread. Fed townsfolk are happier, and bread sells well.',
        cost: { coins: 1_400_000, resources: { planks: 150, bricks: 100, wheat: 300 } }, buildMs: 3 * HOUR, upgradeMs: 6 * HOUR,
        upgradeResources: { bricks: 80, tools: 20 },
        workers: 3, inputs: { flour: 2, wood: 1 }, outputs: { bread: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'smithy', name: 'Smithy', emoji: '🔧', color: 0x4a4e69, tier: 3, kind: 'industry',
        description: 'Forges tools from planks and bricks. Tools unlock heavy industry.',
        cost: { coins: 2_200_000, resources: { planks: 200, bricks: 200, stone: 200 } }, buildMs: 4 * HOUR, upgradeMs: 7 * HOUR,
        upgradeResources: { bricks: 80, tools: 25 },
        workers: 3, inputs: { planks: 2, bricks: 2 }, outputs: { tools: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'mine', name: 'Iron Mine', emoji: '⛏️', color: 0x3d405b, tier: 4, kind: 'industry',
        description: 'Digs iron ore. Needs tools to build and to keep running.',
        cost: { coins: 5_000_000, resources: { tools: 100, bricks: 400, planks: 300 } }, buildMs: 6 * HOUR, upgradeMs: 12 * HOUR,
        upgradeResources: { tools: 80, planks: 150 },
        workers: 4, inputs: { tools: 1 }, outputs: { ore: 4 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'foundry', name: 'Foundry', emoji: '⚙️', color: 0x9d0208, tier: 4, kind: 'industry',
        description: 'Smelts ore into steel.',
        cost: { coins: 18_000_000, resources: { tools: 200, bricks: 800, planks: 400 } }, buildMs: 8 * HOUR, upgradeMs: 16 * HOUR,
        upgradeResources: { tools: 120, bricks: 250 },
        workers: 5, inputs: { ore: 4, wood: 2 }, outputs: { steel: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'factory', name: 'Factory', emoji: '🏭', color: 0x577590, tier: 5, kind: 'industry',
        description: 'Assembles machines from steel, planks and tools.',
        cost: { coins: 90_000_000, resources: { steel: 400, tools: 500, bricks: 1000 } }, buildMs: 12 * HOUR, upgradeMs: 28 * HOUR,
        upgradeResources: { steel: 150, tools: 150 },
        workers: 8, inputs: { steel: 3, planks: 3, tools: 1 }, outputs: { machines: 1 }, popCap: 0, happiness: 0, storage: 0
    },
    {
        id: 'emporium', name: 'Emporium', emoji: '💎', color: 0x7b2cbf, tier: 6, kind: 'industry',
        description: 'Crafts luxuries — the most valuable good a town can produce.',
        cost: { coins: 900_000_000, resources: { machines: 100, steel: 1000, tools: 800, bread: 1000 } }, buildMs: 24 * HOUR, upgradeMs: 48 * HOUR,
        upgradeResources: { machines: 40, steel: 300 },
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

/** What one band demands of `def` at `level`, or 0 below the band's floor. */
export function townUpgradeBandAmount(def: TownBuildingDef, band: typeof TOWN_UPGRADE_BANDS[number], level: number): number {
    if (level < band.minLevel) return 0
    const tierScale = 1 + def.tier * TOWN_UPGRADE_BAND_TIER_SCALE
    return Math.max(1, Math.round(band.base * tierScale * Math.pow(TOWN_LEVEL_RESOURCE_GROWTH, level - band.minLevel)))
}

/** The next band a building has not reached yet, so the UI can warn ahead of time. */
export function townNextUpgradeBand(level: number): typeof TOWN_UPGRADE_BANDS[number] | null {
    return TOWN_UPGRADE_BANDS.find(b => b.minLevel > level) ?? null
}

/**
 * Coins + resources to build (level 1) or upgrade TO `level`. An upgrade is a
 * rebuild at a bigger size, so it pays the base cost again at the level's
 * multiplier, PLUS the building's own `upgradeResources`, PLUS whatever the
 * level bands demand from further up the production chain.
 */
export function townLevelCost(def: TownBuildingDef, level: number): { coins: number, resources: TownResourceBag } {
    const factor = Math.pow(TOWN_LEVEL_COST_GROWTH, level - 1)
    const goodsFactor = Math.pow(TOWN_LEVEL_RESOURCE_GROWTH, level - 1)
    const resources = scaleBag(def.cost.resources, goodsFactor)
    if (level >= 2) {
        for (const [id, qty] of Object.entries(scaleBag(def.upgradeResources, goodsFactor)) as [TownResourceId, number][]) {
            resources[id] = (resources[id] ?? 0) + qty
        }
        // Roads have no levels, so they never reach a band.
        if (def.kind !== 'road') {
            for (const band of TOWN_UPGRADE_BANDS) {
                const qty = townUpgradeBandAmount(def, band, level)
                if (qty > 0) resources[band.resource] = (resources[band.resource] ?? 0) + qty
            }
        }
    }
    return { coins: Math.round(def.cost.coins * factor), resources }
}

/**
 * Residents `def` wants at `level`. The first level costs `workers`, and every
 * level after it costs `workersPerLevel`, which defaults to the same number —
 * so for almost everything this is plainly workers × level.
 */
export function townWorkersFor(def: TownBuildingDef, level: number): number {
    if (level <= 0) return 0
    return def.workers + (def.workersPerLevel ?? def.workers) * (level - 1)
}

/** The highest level `def` can reach. Roads have none; a few buildings stop short of the global cap. */
export function townBuildingMaxLevel(def: TownBuildingDef): number {
    if (def.kind === 'road') return 1
    return def.maxLevel ?? TOWN_MAX_BUILDING_LEVEL
}

/** Build/upgrade duration in ms for reaching `level`. Pass the town's happiness to apply the mood's build-time perk. */
export function townLevelBuildMs(def: TownBuildingDef, level: number, happiness?: number, research: TownResearchBonus = TOWN_NO_RESEARCH): number {
    const mood = happiness === undefined ? 1 : townMood(happiness).buildTime
    const base = level <= 1 ? def.buildMs : def.upgradeMs * Math.pow(TOWN_LEVEL_TIME_GROWTH, level - 2)
    // Research shortens the job before the tier wall is applied, so a maxed
    // Construction branch really does bring a three-day build under the cap.
    const shortened = base * mood * (1 - research.buildTime)
    return Math.min(townMaxBuildMs(def), Math.round(shortened))
}

// ─── Builders ────────────────────────────────────────────────────────────────
// Every build and every upgrade occupies one builder for as long as its clock
// runs, so a town can only grow on as many fronts as it has crews. This is the
// pacing lever the timers alone could never be: without it a mayor starts
// twenty upgrades at once and the whole town is only ever as slow as its
// slowest single building. Three crews come free; the rest cost gems.

export const TOWN_FREE_BUILDERS = 3
export const TOWN_MAX_BUILDERS = 6
/** Gems for the 4th, 5th and 6th crew. Permanent, so the price climbs hard. */
export const TOWN_BUILDER_GEM_COSTS: readonly number[] = [250, 500, 1000]

/** Gems to hire one more crew when the town already has `owned`, or null at the cap. */
export function townBuilderGemCost(owned: number): number | null {
    if (owned >= TOWN_MAX_BUILDERS) return null
    // A town below the free allowance has not paid for anything yet, so the
    // next crew is the first priced one.
    return TOWN_BUILDER_GEM_COSTS[Math.max(0, owned - TOWN_FREE_BUILDERS)] ?? null
}

/**
 * Crews on a job right now. A building counts while its clock is still
 * running, whether that is the first build or an upgrade — roads finish
 * instantly, so they never tie one up.
 */
export function townBuildersBusy(buildings: TownSimBuilding[], now: number): number {
    let busy = 0
    for (const b of buildings) if (b.completesAt > now && (b.level === 0 || b.upgradingTo !== null)) busy++
    return busy
}

/** Crews standing idle, never below zero. */
export function townBuildersFree(buildings: TownSimBuilding[], owned: number, now: number): number {
    return Math.max(0, owned - townBuildersBusy(buildings, now))
}

/** Gems needed to finish a build with `remainingMs` left on the clock. */
export function townRushGemCost(remainingMs: number): number {
    if (remainingMs <= 0) return 0
    return Math.ceil(remainingMs / TOWN_RUSH_MS_PER_GEM)
}

/**
 * Cooldown before buying plot number `plotIndex` (1-based; the first plot is
 * free on founding and has none). Past the end of the table every further plot
 * costs the longest wait on it.
 */
export function townPlotCooldownMs(plotIndex: number): number {
    if (plotIndex <= 1) return 0
    const last = TOWN_PLOT_COOLDOWNS_MS[TOWN_PLOT_COOLDOWNS_MS.length - 1]!
    return TOWN_PLOT_COOLDOWNS_MS[plotIndex - 2] ?? last
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

// ─── Terrain ─────────────────────────────────────────────────────────────────
// Land is not interchangeable. Every tile of the realm has a terrain type
// worked out from its world coordinates, so nothing is stored per tile, the
// server and every client agree without a round trip, and the square you are
// looking at is the same square your neighbour sees. Terrain is what makes one
// plot worth more than the next when they change hands: a wooded, rocky plot
// with a stream through it is a different proposition to eight-by-eight grass.

export const TOWN_TERRAIN_IDS = ['plain', 'water', 'rock', 'forest', 'fertile'] as const
export type TownTerrainId = typeof TOWN_TERRAIN_IDS[number]

/** A building standing on terrain that suits it runs this much harder. */
export const TOWN_TERRAIN_BONUS = 0.25
export interface TownTerrainDef {
    id: TownTerrainId
    name: string
    emoji: string
    /** Tint the ground overlay and its legend paint this terrain with. */
    color: number
    description: string
    /** Nothing may be placed here. */
    blocked: boolean
    /** Buildings that gain TOWN_TERRAIN_BONUS standing on it. */
    boosts: readonly TownBuildingId[]
    /**
     * How many of a plot's 64 tiles this terrain takes, rolled per plot inside
     * these bounds. Every plot is therefore guaranteed its handful of each
     * useful type — a founding plot can never be a wasteland — and water is
     * capped low enough that no plot loses meaningful room to build.
     * `plain` takes whatever is left over, so it has no quota of its own.
     */
    tilesPerPlot: { min: number, max: number }
}

export const TOWN_TERRAINS: readonly TownTerrainDef[] = [
    {
        id: 'plain', name: 'Grassland', emoji: '🌱', color: 0x9dbf6e, blocked: false, boosts: [],
        description: 'No bonus.',
        tilesPerPlot: { min: 0, max: 0 }
    },
    {
        id: 'water', name: 'Water', emoji: '💧', color: 0x4aa3d8, blocked: true, boosts: [],
        description: 'Cannot build.',
        tilesPerPlot: { min: 1, max: 4 }
    },
    {
        id: 'rock', name: 'Rocky', emoji: '🪨', color: 0x9a8c98, blocked: false, boosts: ['quarry', 'mine'],
        description: 'Quarries, iron mines.',
        tilesPerPlot: { min: 4, max: 8 }
    },
    {
        id: 'forest', name: 'Woodland', emoji: '🌲', color: 0x3f7a4d, blocked: false, boosts: ['lumber'],
        description: 'Lumber camps.',
        tilesPerPlot: { min: 5, max: 9 }
    },
    {
        id: 'fertile', name: 'Fertile', emoji: '🌾', color: 0xc7a02c, blocked: false, boosts: ['farm'],
        description: 'Farms.',
        tilesPerPlot: { min: 5, max: 9 }
    }
]

const TERRAIN_BY_ID = new Map(TOWN_TERRAINS.map(t => [t.id, t]))

export function getTownTerrain(id: TownTerrainId): TownTerrainDef {
    return TERRAIN_BY_ID.get(id)!
}

/** Deterministic 32-bit mix of three integers, mapped to [0, 1). */
function terrainHash(x: number, y: number, salt: number): number {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000
}

/**
 * Smooth value noise over the tile grid. It is sampled in WORLD coordinates on
 * purpose: a wood should not stop dead at a plot boundary, so buying the land
 * next door carries the same trees on into it.
 */
function terrainNoise(wx: number, wy: number, salt: number, scale: number): number {
    const x = wx / scale
    const y = wy / scale
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const ease = (t: number) => t * t * (3 - 2 * t)
    const fx = ease(x - x0)
    const fy = ease(y - y0)
    const near = terrainHash(x0, y0, salt) * (1 - fx) + terrainHash(x0 + 1, y0, salt) * fx
    const far = terrainHash(x0, y0 + 1, salt) * (1 - fx) + terrainHash(x0 + 1, y0 + 1, salt) * fx
    return near * (1 - fy) + far * fy
}

/** Two octaves: broad patches with a little ragged edge on them. */
function terrainField(wx: number, wy: number, salt: number): number {
    return terrainNoise(wx, wy, salt, 3.5) * 0.7 + terrainNoise(wx, wy, salt + 977, 1.7) * 0.3
}

/**
 * Roughly this share of the realm is flat grassland: nothing to be had from
 * the ground, but no water on it either, so all 64 tiles are buildable. It is
 * the cheap end of the land market and a real trade-off rather than a worse
 * plot — and it is why two squares on the market are never quite the same.
 * A town is never FOUNDED on one (see claimFoundingPlot); flat ground is
 * something you buy on purpose.
 */
export const TOWN_FLAT_PLOT_CHANCE = 0.06

export function townPlotIsFlat(px: number, py: number): boolean {
    return terrainHash(px, py, 7717) < TOWN_FLAT_PLOT_CHANCE
}

// Terrain is a pure function of the coordinates, so a cached plot can never go
// stale — the map only ever grows. A town holds twelve plots and a world view
// a few dozen more; the cap is there so a long-lived server process that pans
// over a lot of land does not keep every square it ever drew.
const terrainCache = new Map<string, readonly TownTerrainId[]>()
const TERRAIN_CACHE_LIMIT = 4096

/**
 * The 64 tiles of plot (px, py), row-major (`ty * 8 + tx`).
 *
 * Each terrain rolls a count and then takes that many of the highest tiles of
 * its own noise field. Doing it in that order — rather than thresholding the
 * noise — is what lets the counts be guaranteed and the shapes still be
 * patches instead of confetti.
 */
export function townPlotTerrain(px: number, py: number): readonly TownTerrainId[] {
    const key = `${px},${py}`
    const cached = terrainCache.get(key)
    if (cached) return cached

    // Flat grassland skips all of this and stays 64 plain tiles.
    const tiles: TownTerrainId[] = new Array(TOWN_TILES_PER_PLOT).fill('plain')
    let salt = 1
    for (const def of townPlotIsFlat(px, py) ? [] : TOWN_TERRAINS) {
        salt += 101
        if (def.tilesPerPlot.max <= 0) continue
        const { min, max } = def.tilesPerPlot
        const count = min + Math.floor(terrainHash(px, py, salt) * (max - min + 1))
        const ranked: { index: number, value: number }[] = []
        for (let ty = 0; ty < TOWN_PLOT_SIZE; ty++) {
            for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
                const index = ty * TOWN_PLOT_SIZE + tx
                if (tiles[index] !== 'plain') continue
                ranked.push({ index, value: terrainField(px * TOWN_PLOT_SIZE + tx, py * TOWN_PLOT_SIZE + ty, salt) })
            }
        }
        // Ties break on the tile index, so the layout never rides on how the
        // engine happens to sort equal values.
        ranked.sort((a, b) => b.value - a.value || a.index - b.index)
        for (let i = 0; i < count && i < ranked.length; i++) tiles[ranked[i]!.index] = def.id
    }

    if (terrainCache.size >= TERRAIN_CACHE_LIMIT) terrainCache.clear()
    terrainCache.set(key, tiles)
    return tiles
}

/** Terrain on a world tile. */
export function townTerrainAt(wx: number, wy: number): TownTerrainId {
    const px = Math.floor(wx / TOWN_PLOT_SIZE)
    const py = Math.floor(wy / TOWN_PLOT_SIZE)
    return townPlotTerrain(px, py)[(wy - py * TOWN_PLOT_SIZE) * TOWN_PLOT_SIZE + (wx - px * TOWN_PLOT_SIZE)]!
}

/**
 * What the ground under a building is worth to it. Buildings with no world
 * coordinates — unit fixtures, rows written before plots had tiles — stand on
 * nothing in particular and get the plain rate.
 */
export function townTerrainMultiplier(type: TownBuildingId, wx?: number, wy?: number): number {
    if (wx === undefined || wy === undefined) return 1
    return getTownTerrain(townTerrainAt(wx, wy)).boosts.includes(type) ? 1 + TOWN_TERRAIN_BONUS : 1
}

// ─── Supply chains ───────────────────────────────────────────────────────────
// A workshop wants its raw materials nearby. Distance is measured in ROAD
// TILES travelled, not as the crow flies, so the shape of your street network
// is what decides whether a sawmill runs at full speed. Supply is also
// finite: one lumber camp cannot feed five sawmills, and when several
// workshops compete the closest pairing wins, so a camp on the left feeds the
// sawmill on the left rather than being spread thin across the town.

/**
 * Inside this many road tiles a supplier delivers at full rate. Measured
 * against real towns: workshops sharing a plot sit two to five tiles apart,
 * while anything across a plot boundary is six or more, so this is the line
 * between "same district" and "the other side of town".
 */
export const TOWN_SUPPLY_FULL_TILES = 4
/** By this distance a supplier has fallen to the minimum rate. */
export const TOWN_SUPPLY_FALLOFF_TILES = 16
/**
 * The slowest a workshop ever runs. It is never zero: goods bought from other
 * mayors have no local supplier at all, and buying should still be worth
 * something — just slower than making them next door.
 */
export const TOWN_SUPPLY_MIN_EFFICIENCY = 0.3

/**
 * What finished research adds to a town. Declared here rather than imported so
 * the rules module stays free of the research board: the shape matches what
 * townResearchEffects() returns, and a town that has researched nothing simply
 * passes TOWN_NO_RESEARCH.
 */
export interface TownResearchBonus {
    /** Extra share of output from every workshop. */
    output: number
    /** Extra road tiles a supplier covers at full rate. */
    supplyTiles: number
    /** Share taken off every build and upgrade timer. */
    buildTime: number
    /** Extra residents per house level. */
    popPerHouseLevel: number
    /** Flat points on the happiness target. */
    happiness: number
    /** Extra share of the per-resource storage cap. */
    storage: number
}

export const TOWN_NO_RESEARCH: TownResearchBonus = {
    output: 0,
    supplyTiles: 0,
    buildTime: 0,
    popPerHouseLevel: 0,
    happiness: 0,
    storage: 0
}

/** How much of a delivery survives the trip. */
export function townSupplyEfficiency(tiles: number, extraFullTiles = 0): number {
    const full = TOWN_SUPPLY_FULL_TILES + extraFullTiles
    if (tiles <= full) return 1
    if (tiles >= TOWN_SUPPLY_FALLOFF_TILES) return TOWN_SUPPLY_MIN_EFFICIENCY
    const span = Math.max(1, TOWN_SUPPLY_FALLOFF_TILES - full)
    return 1 - (1 - TOWN_SUPPLY_MIN_EFFICIENCY) * ((tiles - full) / span)
}

/**
 * How deep in the chain each resource sits: raw goods are 0, and every
 * refinement is one deeper. Resolving supply in this order means a mill's own
 * throughput is already known by the time a bakery asks it for flour.
 */
const RESOURCE_DEPTH: Map<TownResourceId, number> = (() => {
    const depth = new Map<TownResourceId, number>()
    for (const r of TOWN_RESOURCES) depth.set(r.id, 0)
    // Repeat until stable; the chain is a dozen links, so this settles fast.
    for (let pass = 0; pass < TOWN_RESOURCES.length; pass++) {
        for (const def of TOWN_BUILDINGS) {
            const inputs = Object.keys(def.inputs) as TownResourceId[]
            if (inputs.length === 0) continue
            const deepest = Math.max(...inputs.map(i => depth.get(i) ?? 0))
            for (const out of Object.keys(def.outputs) as TownResourceId[]) {
                if ((depth.get(out) ?? 0) < deepest + 1) depth.set(out, deepest + 1)
            }
        }
    }
    return depth
})()

export function townResourceDepth(id: TownResourceId): number {
    return RESOURCE_DEPTH.get(id) ?? 0
}

/**
 * Road distances between the front doors buildings deliver through. Buildings
 * do not move during a settle, so this is computed once and reused for every
 * tick rather than re-walked per tick.
 */
export interface TownSupplyNetwork {
    /** Each building's front-door road tile, as "x,y". */
    frontOf: Map<string, string>
    /** Road tiles travelled between two front doors; missing means no road joins them. */
    between: Map<string, Map<string, number>>
}

export function townSupplyNetwork(buildings: TownSimBuilding[], now = Date.now()): TownSupplyNetwork {
    const roads = new Set<string>()
    for (const b of buildings) {
        if (b.type === 'road' && b.wx !== undefined && b.wy !== undefined && isBuilt(b, now)) {
            roads.add(`${b.wx},${b.wy}`)
        }
    }

    const frontOf = new Map<string, string>()
    const sources = new Set<string>()
    for (const b of buildings) {
        if (b.wx === undefined || b.wy === undefined || b.type === 'road') continue
        const def = BUILDING_BY_ID.get(b.type)!
        if (def.kind !== 'industry') continue
        const f = townFrontTile(b.wx, b.wy, b.rotation ?? 0)
        const key = `${f.wx},${f.wy}`
        if (!roads.has(key)) continue
        frontOf.set(b.id, key)
        if (Object.keys(def.outputs).length > 0) sources.add(key)
    }

    // One breadth-first walk per delivering front door covers every workshop
    // that door can reach, so the whole map costs sources × road tiles.
    const between = new Map<string, Map<string, number>>()
    for (const start of sources) {
        const seen = new Map<string, number>([[start, 0]])
        let frontier = [start]
        while (frontier.length > 0) {
            const next: string[] = []
            for (const tile of frontier) {
                const d = seen.get(tile)!
                const [tx, ty] = tile.split(',').map(Number) as [number, number]
                for (const [dx, dy] of TOWN_FACING) {
                    const nb = `${tx + dx},${ty + dy}`
                    if (!roads.has(nb) || seen.has(nb)) continue
                    seen.set(nb, d + 1)
                    next.push(nb)
                }
            }
            frontier = next
        }
        between.set(start, seen)
    }
    return { frontOf, between }
}

/** Road tiles between two buildings, or null when no road joins them. */
export function townRoadDistance(network: TownSupplyNetwork, fromId: string, toId: string): number | null {
    const from = network.frontOf.get(fromId)
    const to = network.frontOf.get(toId)
    if (from === undefined || to === undefined) return null
    if (from === to) return 0
    return network.between.get(from)?.get(to) ?? null
}

export interface TownSupplyEntry {
    /** How much of what this workshop needs actually arrives, TOWN_SUPPLY_MIN_EFFICIENCY .. 1. */
    ratio: number
    /** Per input resource: how well it is served, and where from. */
    inputs: { resource: TownResourceId, ratio: number, nearestTiles: number | null, suppliers: number }[]
}

/**
 * Work out how well every workshop is supplied. Producers are allocated to
 * consumers closest-pair-first, so the nearest workshop gets first claim on
 * the nearest supplier and a single camp cannot be counted twice.
 */
export function townSupply(
    buildings: TownSimBuilding[],
    staffing: Map<string, number>,
    network: TownSupplyNetwork,
    now = Date.now(),
    extraFullTiles = 0
): Map<string, TownSupplyEntry> {
    const active = buildings
        .filter(b => isBuilt(b, now) && BUILDING_BY_ID.get(b.type)!.kind === 'industry')
        .map(b => ({ b, def: BUILDING_BY_ID.get(b.type)!, level: effectiveLevel(b, now), staff: staffing.get(b.id) ?? 0 }))

    const result = new Map<string, TownSupplyEntry>()
    const ratioOf = new Map<string, number>()
    for (const a of active) {
        // Nothing to haul in, or no place on the map at all (a fixture without
        // world coordinates) — either way there is no journey to slow down.
        if (Object.keys(a.def.inputs).length === 0 || !network.frontOf.has(a.b.id)) {
            ratioOf.set(a.b.id, 1)
            result.set(a.b.id, { ratio: 1, inputs: [] })
        }
    }

    const consumed = new Set<TownResourceId>()
    for (const a of active) for (const id of Object.keys(a.def.inputs) as TownResourceId[]) consumed.add(id)
    const order = [...consumed].sort((x, y) => townResourceDepth(x) - townResourceDepth(y))

    // Per consumer, how well each of its inputs is served.
    const perInput = new Map<string, { resource: TownResourceId, ratio: number, nearestTiles: number | null, suppliers: number }[]>()

    for (const resource of order) {
        const producers = active
            .filter(a => (a.def.outputs[resource] ?? 0) > 0 && a.staff > 0)
            .map(a => ({
                id: a.b.id,
                // A supplier can only pass on what it manages to make itself.
                left: (a.def.outputs[resource] ?? 0) * a.level * a.staff * (ratioOf.get(a.b.id) ?? TOWN_SUPPLY_MIN_EFFICIENCY)
            }))
        const consumers = active
            // Only a workshop with people in it competes for deliveries; an
            // idle one holding a claim would starve a working neighbour.
            .filter(a => (a.def.inputs[resource] ?? 0) > 0 && a.staff > 0 && network.frontOf.has(a.b.id))
            .map(a => ({ id: a.b.id, need: (a.def.inputs[resource] ?? 0) * a.level * a.staff, left: 0, got: 0, nearest: null as number | null, suppliers: 0 }))
        for (const c of consumers) c.left = c.need

        const pairs: { c: typeof consumers[number], p: typeof producers[number], tiles: number }[] = []
        for (const c of consumers) {
            for (const p of producers) {
                const tiles = townRoadDistance(network, p.id, c.id)
                if (tiles === null) continue
                pairs.push({ c, p, tiles })
            }
        }
        // Closest pair first: the near sawmill takes the near camp, and what is
        // left over spills to whoever is next closest.
        pairs.sort((a, b) => a.tiles - b.tiles)
        for (const { c, p, tiles } of pairs) {
            if (c.left <= 0 || p.left <= 0) continue
            const take = Math.min(c.left, p.left)
            c.left -= take
            p.left -= take
            c.got += take * townSupplyEfficiency(tiles, extraFullTiles)
            c.suppliers++
            if (c.nearest === null || tiles < c.nearest) c.nearest = tiles
        }

        for (const c of consumers) {
            const ratio = Math.max(TOWN_SUPPLY_MIN_EFFICIENCY, Math.min(1, c.need > 0 ? c.got / c.need : 1))
            const list = perInput.get(c.id) ?? []
            list.push({ resource, ratio, nearestTiles: c.nearest, suppliers: c.suppliers })
            perInput.set(c.id, list)
            // A workshop runs at the pace of its worst-served input.
            ratioOf.set(c.id, Math.min(ratioOf.get(c.id) ?? 1, ratio))
        }
    }

    for (const a of active) {
        const inputs = perInput.get(a.b.id)
        if (!inputs) continue
        result.set(a.b.id, { ratio: ratioOf.get(a.b.id) ?? 1, inputs })
    }
    return result
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
    /** What the town's finished research adds. Absent means none of it. */
    research?: TownResearchBonus
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
    /** How well each workshop's inputs reach it over the roads (0.3 .. 1). */
    supply: Map<string, TownSupplyEntry>
    /** What a building actually runs at: staffing × supply. This is the rate production uses. */
    throughput: Map<string, number>
    /** Happiness → production speed multiplier, 0.5 .. 1.0. */
    speedMultiplier: number
    /** Units the town consumes per tick for each need. */
    needsPerTick: Partial<Record<TownResourceId, number>>
    /** Highest resource tier the town is expected to be able to stock. */
    reachableTier: number
    /** Where the happiness target came from, line by line. */
    happinessBreakdown: {
        base: number
        needs: number
        parks: number
        industry: number
        crowding: number
        layout: TownLayoutScore
    }
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
    if (getTownTerrain(townTerrainAt(wx, wy)).blocked) return 'You cannot build on water'
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
export interface TownLayoutScore {
    /** Points from parks, 0 .. TOWN_PARK_MAX_BONUS. */
    parks: number
    /** Points lost to industry, 0 .. TOWN_INDUSTRY_MAX_PENALTY (positive number). */
    industry: number
    residents: number
    /** Residents with a park in reach, and residents with industry in reach. */
    residentsWithPark: number
    residentsWithIndustry: number
}

/**
 * Scores the layout by residents rather than by buildings: a level-10 house
 * next to a foundry is ten times the misery of a level-1 one, and covering
 * every home with a park is worth the full bonus however many homes there are.
 */
export function townLayoutScore(buildings: TownSimBuilding[], now = Date.now()): TownLayoutScore {
    let residents = 0
    let withPark = 0
    let withIndustry = 0
    let nuisance = 0
    for (const b of buildings) {
        if (b.type !== 'house' || b.wx === undefined || b.wy === undefined || !isBuilt(b, now)) continue
        const people = BUILDING_BY_ID.get(b.type)!.popCap * effectiveLevel(b, now)
        residents += people
        const { parks, industryPenalty } = houseAdjacency(buildings, b.wx, b.wy, now)
        if (parks > 0) withPark += people
        if (industryPenalty > 0) withIndustry += people
        nuisance += people * industryPenalty
    }
    if (residents === 0) return { parks: 0, industry: 0, residents: 0, residentsWithPark: 0, residentsWithIndustry: 0 }
    return {
        parks: Math.round(TOWN_PARK_MAX_BONUS * withPark / residents),
        industry: Math.min(TOWN_INDUSTRY_MAX_PENALTY, Math.round(nuisance / residents * TOWN_INDUSTRY_PENALTY_SCALE)),
        residents,
        residentsWithPark: withPark,
        residentsWithIndustry: withIndustry
    }
}

/** Net layout points, positive or negative. */
export function adjacencyHappiness(buildings: TownSimBuilding[], now = Date.now()): number {
    const score = townLayoutScore(buildings, now)
    return score.parks - score.industry
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
                industryPenalty += penalty
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
export function townTierUnlocked(
    buildings: TownSimBuilding[],
    tier: number,
    now: number,
    produced: TownResourceBag = {},
    research: TownResearchBonus = TOWN_NO_RESEARCH
): boolean {
    return townTierRequirement(buildings, tier, now, produced, research) === null
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
export function townTierRequirement(
    buildings: TownSimBuilding[],
    tier: number,
    now: number,
    produced: TownResourceBag = {},
    research: TownResearchBonus = TOWN_NO_RESEARCH
): TownTierLock | null {
    if (tier <= 1) return null
    const hasPrevious = buildings.some(b => isBuilt(b, now) && BUILDING_BY_ID.get(b.type)!.tier === tier - 1)
    let pop = 0
    for (const b of buildings) {
        if (!isBuilt(b, now) || !townRoadAccess(buildings, b)) continue
        const def = BUILDING_BY_ID.get(b.type)!
        // The same sum deriveTown does: residents a Civics project added are
        // real residents, and the gate has to see the ones already at work.
        pop += (def.popCap + (def.popCap > 0 ? research.popPerHouseLevel : 0)) * effectiveLevel(b, now)
    }
    const popRequired = TOWN_TIER_POP_REQUIREMENT[tier] ?? 0
    const req = TOWN_TIER_PRODUCTION_REQUIREMENT[tier]
    const producedTier = req?.tier ?? tier - 1
    const producedRequired = req?.amount ?? 0
    const made = townProducedOfTier(produced, producedTier)
    if (hasPrevious && pop >= popRequired && made >= producedRequired) return null
    return { needsBuilding: !hasPrevious, pop, popRequired, produced: made, producedRequired, producedTier }
}

/**
 * Exactly what one tick moves through a workshop, or null when it moves
 * nothing. Output is floored, so a workshop running slowly enough that its
 * output rounds to zero consumes nothing either — the settle skips it, and
 * every number shown to the player has to agree with that.
 */
export function townTickRecipe(def: TownBuildingDef, level: number, ratio: number): { inputs: TownResourceBag, outputs: TownResourceBag } | null {
    if (ratio <= 0) return null
    const outputs = scaleBag(def.outputs, level * ratio, Math.floor)
    if (Object.keys(outputs).length === 0) return null
    return { inputs: scaleBag(def.inputs, level * ratio, Math.ceil), outputs }
}

/** Net resource change per tick at current staffing, assuming inputs are available. */
export function townNetPerTick(buildings: TownSimBuilding[], derived: TownDerived, now: number): TownResourceBag {
    const net: TownResourceBag = {}
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const def = BUILDING_BY_ID.get(b.type)!
        if (def.kind !== 'industry') continue
        const level = effectiveLevel(b, now)
        const recipe = townTickRecipe(def, level, derived.throughput.get(b.id) ?? 0)
        if (!recipe) continue
        for (const [id, qty] of Object.entries(recipe.outputs) as [TownResourceId, number][]) {
            net[id] = (net[id] ?? 0) + qty
        }
        for (const [id, qty] of Object.entries(recipe.inputs) as [TownResourceId, number][]) {
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
export function deriveTown(
    buildings: TownSimBuilding[],
    happiness: number,
    now: number,
    satisfied: TownSatisfied = {},
    network?: TownSupplyNetwork,
    research: TownResearchBonus = TOWN_NO_RESEARCH
): TownDerived {
    let popCap = 0
    let happinessTarget = TOWN_HAPPINESS_BASE_TARGET
    let storageCap = TOWN_BASE_STORAGE
    let industryTiles = 0
    let workersDemanded = 0

    const built = buildings
        .filter(b => isBuilt(b, now) && townRoadAccess(buildings, b))
        .map(b => ({ b, def: BUILDING_BY_ID.get(b.type)!, level: effectiveLevel(b, now) }))
        .sort((a, z) => a.b.createdAt - z.b.createdAt)

    for (const { b, def, level } of built) {
        popCap += (def.popCap + (def.popCap > 0 ? research.popPerHouseLevel : 0)) * level
        happinessTarget += def.happiness * level
        if (def.kind === 'industry') industryTiles++
        workersDemanded += townWorkersFor(def, level)
    }

    const builtSims = built.map(x => x.b)
    const layout = townLayoutScore(builtSims, now)
    const reachableTier = townReachableTier(builtSims, now)
    const crowding = workersDemanded > popCap * TOWN_HAPPINESS_CROWDING_RATIO ? TOWN_HAPPINESS_CROWDING_PENALTY : 0
    const needsScore = needsHappiness(satisfied, popCap, reachableTier)
    happinessTarget += layout.parks - layout.industry - crowding + needsScore
    happinessTarget = Math.max(0, Math.min(100, happinessTarget + research.happiness))

    // Residents are handed out oldest building first, and a warehouse queues
    // with everything else: unstaffed, it holds only what its crew can manage.
    const staffing = new Map<string, number>()
    let remaining = popCap
    for (const { b, def, level } of built) {
        const need = townWorkersFor(def, level)
        const got = Math.min(need, remaining)
        remaining -= got
        const ratio = need === 0 ? 1 : got / need
        staffing.set(b.id, ratio)
        if (def.storage > 0) storageCap += Math.floor(def.storage * level * ratio)
    }
    // Applied once the warehouses have reported what they can actually hold.
    storageCap = Math.round(storageCap * townMood(happiness).storage * (1 + research.storage))

    // Road distances are the expensive half and never change mid-settle, so a
    // caller walking many ticks passes the network in rather than rebuilding it.
    const supply = townSupply(builtSims, staffing, network ?? townSupplyNetwork(buildings, now), now, research.supplyTiles)
    // Terrain rides on the same ratio as staffing and supply rather than being
    // bolted onto the output bag afterwards. Everything that quotes a rate —
    // the tick loop, the net-per-tick preview, the income estimate — reads
    // throughput and floors it identically, so a bonus that only one of them
    // knew about is a number the player would catch us lying about.
    // Only workshops turn residents into goods. Everything else is staffed
    // from the same pool — a warehouse holds what its crew can manage — but has
    // no throughput to speak of.
    const throughput = new Map<string, number>()
    for (const { b, def } of built) {
        if (def.kind !== 'industry') continue
        const staff = staffing.get(b.id) ?? 0
        throughput.set(b.id, staff * (supply.get(b.id)?.ratio ?? 1) * townTerrainMultiplier(def.id, b.wx, b.wy) * (1 + research.output))
    }

    return {
        popCap,
        workersDemanded,
        workersEmployed: popCap - remaining,
        happinessTarget,
        storageCap,
        industryTiles,
        staffing,
        supply,
        throughput,
        speedMultiplier: townSpeedMultiplier(happiness),
        needsPerTick: townNeedsPerTick(popCap, reachableTier),
        reachableTier,
        happinessBreakdown: {
            base: TOWN_HAPPINESS_BASE_TARGET,
            needs: needsScore,
            parks: layout.parks,
            industry: -layout.industry || 0,
            crowding: -crowding || 0,
            layout
        }
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

    // Research never changes mid-window: a project that finishes while the
    // player is away is banked by settleTownResearch before this runs.
    const research = state.research ?? TOWN_NO_RESEARCH

    let happiness = state.happiness
    let progress = state.tickProgressMs
    let ticks = 0
    let satisfied: TownSatisfied = {}
    for (const n of TOWN_NEEDS) satisfied[n.resource] = (inv[n.resource] ?? 0) > 0

    // Walk the window in whole ticks. Buildings that finish mid-window start
    // producing from the tick after their completion timestamp.
    let cursor = from
    // Buildings do not move mid-settle, so the road distances behind the supply
    // chains are walked once here instead of on every tick.
    const network = townSupplyNetwork(buildings, now)
    let derived = deriveTown(buildings, happiness, cursor, satisfied, network, research)
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
        derived = deriveTown(buildings, happiness, cursor, satisfied, network, research)

        for (const b of buildings) {
            if (!isBuilt(b, cursor)) continue
            const def = BUILDING_BY_ID.get(b.type)!
            if (def.kind !== 'industry') continue
            const level = effectiveLevel(b, cursor)
            const recipe = townTickRecipe(def, level, derived.throughput.get(b.id) ?? 0)
            if (!recipe) continue
            const { inputs, outputs } = recipe

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
        const target = deriveTown(buildings, happiness, cursor, satisfied, network, research).happinessTarget
        if (happiness < target) happiness = Math.min(target, happiness + TOWN_HAPPINESS_DRIFT_PER_TICK)
        else if (happiness > target) happiness = Math.max(target, happiness - TOWN_HAPPINESS_DRIFT_PER_TICK)
        derived = deriveTown(buildings, happiness, cursor, satisfied, network, research)
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
export function townFloorIncomePerDay(
    buildings: TownSimBuilding[],
    happiness: number,
    now: number,
    research: TownResearchBonus = TOWN_NO_RESEARCH
): number {
    const derived = deriveTown(buildings, happiness, now, {}, undefined, research)
    const ticksPerDay = (24 * 60 * 60_000) / TOWN_TICK_MS * derived.speedMultiplier
    let perTick = 0
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const def = BUILDING_BY_ID.get(b.type)!
        if (def.kind !== 'industry') continue
        const level = effectiveLevel(b, now)
        // Priced off the very bags the tick loop moves, so the headline number
        // never advertises output a workshop is too slow to actually finish.
        const recipe = townTickRecipe(def, level, derived.throughput.get(b.id) ?? 0)
        if (!recipe) continue
        for (const [id, qty] of Object.entries(recipe.outputs) as [TownResourceId, number][]) {
            perTick += qty * townFloorPrice(id)
        }
        for (const [id, qty] of Object.entries(recipe.inputs) as [TownResourceId, number][]) {
            perTick -= qty * townFloorPrice(id)
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
    { id: 'first-sale', title: 'First Sale', description: 'Earn 1,000 coins selling to the town hall.', emoji: '💰', reward: 0, gems: 1, tier: 0, progress: s => ({ current: Math.min(1_000, s.coinsEarned), target: 1_000 }) },
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
    { id: 'merchant', title: 'Merchant', description: 'Earn 1M coins selling to the town hall.', emoji: '🏪', reward: 0, gems: 8, tier: 3, progress: s => ({ current: Math.min(1_000_000, s.coinsEarned), target: 1_000_000 }) },
    { id: 'deep-dig', title: 'Deep Dig', description: 'Build an Iron Mine.', emoji: '⛏️', reward: 0, gems: 10, tier: 4, progress: built('mine') },
    { id: 'steelworks', title: 'Steelworks', description: 'Build a Foundry.', emoji: '⚙️', reward: 0, gems: 12, tier: 4, progress: built('foundry') },
    { id: 'maxed', title: 'Perfectionist', description: 'Upgrade any building to level 10.', emoji: '🏅', reward: 0, gems: 10, tier: 4, progress: s => ({ current: Math.min(10, s.maxLevel), target: 10 }) },
    { id: 'industrialist', title: 'Industrialist', description: 'Build a Factory.', emoji: '🏭', reward: 20_000_000, gems: 20, tier: 5, progress: built('factory') },
    { id: 'tycoon', title: 'Tycoon', description: 'Build an Emporium.', emoji: '💎', reward: 150_000_000, gems: 40, tier: 6, progress: built('emporium') },
    { id: 'magnate', title: 'Magnate', description: 'Earn 100M coins selling to the town hall.', emoji: '👑', reward: 10_000_000, gems: 25, tier: 6, progress: s => ({ current: Math.min(100_000_000, s.coinsEarned), target: 100_000_000 }) }
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
