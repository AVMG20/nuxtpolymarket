/** Shared types for the caravan idle game. Used identically on client and server. */

export type ResourceId = string
export type NodeId = number
export type EdgeId = string

export type NodeKind = 'capital' | 'resource' | 'camp'

export interface WorldNode {
    id: NodeId
    kind: NodeKind
    /** World-space position, arbitrary units. The renderer scales these to the viewport. */
    x: number
    y: number
    tier: number
    name: string
    /** Resource nodes only: what comes out of the ground here. */
    resource?: ResourceId
    /** Resource nodes only: yield per harvest cycle at full richness. */
    yield?: number
    /** How much can be pulled before the node runs dry, in yield units. */
    capacity?: number
    /** Camps only: combined worker power needed to clear it. */
    power?: number
    /** Camps only: what the camp drops the first time it is cleared. */
    loot?: { coins: number, resources: Record<ResourceId, number> }
    /**
     * Gem seams pay a fraction of a gem per delivery on top of their ore. They
     * are the only source of gems in the game and there are five in the world.
     */
    gemYield?: number
}

export interface WorldEdge {
    id: EdgeId
    a: NodeId
    b: NodeId
    /** World-space length, drives travel time. */
    length: number
}

export interface World {
    seed: number
    nodes: WorldNode[]
    edges: WorldEdge[]
    /** Adjacency list, node id -> edge ids. Rebuilt on load, never persisted. */
    adjacency: Record<NodeId, EdgeId[]>
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemSlot = 'tool' | 'weapon' | 'pack'

export type Category = 'wood' | 'stone' | 'ore' | 'fiber' | 'gem'

/**
 * `yield_*` affixes only pay out while harvesting a seam of that category, which
 * is why they roll so much higher than the generic ones.
 */
export type CategoryYieldStat = `yield_${Category}`

/**
 * `strength` is both how hard a worker swings at a seam and how hard they hit a
 * camp. It replaced separate harvest and combat stats, which always moved
 * together and gave a player two numbers to read where one would do.
 */
export type AffixStat =
    | 'strength'
    | 'carryCapacity'
    | 'speed'
    | 'hungerReduction'
    | 'coinFind'
    | 'xpGain'
    | CategoryYieldStat

export type Make = 'dwarven' | 'sylvan' | 'ashen' | 'gilded' | 'runed'

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface Affix {
    stat: AffixStat
    /** Additive percentage, e.g. 140 means +140%. */
    value: number
    /** Where in the affix's roll range this landed, 0-1. Drives the quality bar in the UI. */
    quality: number
}

export interface Item {
    id: string
    base: string
    slot: ItemSlot
    tier: number
    rarity: Rarity
    /** Forging tradition. Three matching pieces on one worker unlock a set bonus. */
    make: Make
    affixes: Affix[]
    /** Epoch ms, so the workshop can sort by newest. */
    rolledAt: number
    /** How many times this item has been reforged, for the UI to show its history. */
    reforges?: number
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export type WorkerActivity =
    | { type: 'idle' }
    | { type: 'travel', from: NodeId, to: NodeId, startedAt: number, arrivesAt: number }
    | { type: 'harvest', at: NodeId, startedAt: number, doneAt: number }
    | { type: 'unload', at: NodeId, doneAt: number }
    | { type: 'assault', at: NodeId, startedAt: number, resolvesAt: number }
    | { type: 'starving', at: NodeId }

export interface Worker {
    id: string
    name: string
    tier: number
    rarity: Rarity
    level: number
    xp: number
    /**
     * Categories this worker is good at. A specialist harvests its own seams
     * faster and reads them as one priority step higher than they are set, so it
     * gravitates to the right work without anyone assigning it.
     */
    specialties: Category[]
    /**
     * Stats at level 1, rolled at hire. Levelling walks these toward `growth`
     * times themselves, so rarity buys a ceiling rather than a starting point.
     */
    base: { speed: number, carry: number, strength: number, hunger: number }
    /** Multiplier this worker's stats reach at max level. Set by rarity. */
    growth: number
    equipment: Partial<Record<ItemSlot, string>>
    /** Current food reserve, 0-100. Hits zero and the worker stalls until fed. */
    food: number
    /**
     * The node this worker is currently working. Set by the allocator from node
     * priorities, never by the player -- there is no per-worker assignment.
     */
    assignment: NodeId | null
    /** Where the worker physically is, or the node it most recently left. */
    at: NodeId
    /** Cached route to the destination, so pathfinding runs once and not per tick. */
    route: NodeId[]
    routeIndex: number
    /** What the worker is hauling right now. */
    cargo: Record<ResourceId, number>
    activity: WorkerActivity
}

// ---------------------------------------------------------------------------
// Persisted save state
// ---------------------------------------------------------------------------

export interface CaravanState {
    version: number
    /** Highest tier the player has advanced to. Gates nodes, research and crafting. */
    tier: number
    /** Epoch ms of the last simulated instant. */
    lastTick: number
    rngSeed: number
    rngCursor: number
    resources: Record<ResourceId, number>
    /** Node ids the player has bought, in purchase order. */
    ownedNodes: NodeId[]
    /** Work priority per node, 0 (off) to 5 (critical). Missing means Low. */
    nodePriority: Record<NodeId, number>
    /** How many workers may work a node at once. Missing means the base capacity. */
    nodeCapacity: Record<NodeId, number>
    /** Node ids designated as capitals. The first one is the haul destination. */
    capitals: NodeId[]
    /** Camps already cleared. */
    clearedCamps: NodeId[]
    /** Road upgrade level per edge, 0 = dirt. */
    roads: Record<EdgeId, number>
    /** Harvested-out amount per node, regenerates over time. */
    depletion: Record<NodeId, { drawn: number, at: number }>
    workers: Worker[]
    items: Item[]
    research: string[]
    /** Standing orders that run inside the simulation. See `policies` in config. */
    policies: CaravanPolicies
    /** Gem-bought permanent worker slots, on top of whatever research grants. */
    charters: number
    /** Gem-bought permanent capital slots. */
    deeds: number
    /** Salvage currency, spent on rerolls and guaranteed rarity crafts. */
    shards: number
    /**
     * Recent simulation events, newest last. Persisted so the feed survives a
     * page change -- previously it only held whatever the last catch-up produced,
     * which meant navigating away threw away everything that had happened.
     */
    log: SimEvent[]
    /** Batches on the refinery lines, oldest first. */
    refineJobs: RefineJob[]
    /** The research currently being carried out, if any. */
    researchJob: ResearchJob | null
    /**
     * Gems earned from gem seams but not yet credited. Fractional, because a
     * single delivery is worth a fraction of a gem.
     */
    pendingGems: number
    /**
     * Recruitment slate bookkeeping. The slate itself is derived from
     * (seed, window, refreshes, slot) rather than stored.
     */
    market: { window: number, purchased: number[], refreshes: number }
    /** Coins earned by the sim since the last flush, paid out on save. */
    pendingCoins: number
    stats: {
        totalHauled: number
        /** Coin value of everything ever delivered, at sale prices. */
        hauledValue: number
        tripsCompleted: number
        campsCleared: number
    }
}

/**
 * Automation the player switches on once managing every worker by hand stops
 * being a decision and starts being a chore. Each one is unlocked by research,
 * which lands at roughly the tier where the worker cap makes it necessary.
 */
export interface CaravanPolicies {
    /** The kitchen bakes provisions on demand instead of starving. */
    autoRefine: boolean
    /** Commissions below this rarity go straight to shards. Null keeps everything. */
    autoSalvageBelow: Rarity | null
}

export interface RefineJob {
    id: string
    recipeId: string
    batches: number
    /** Which refinery line this batch was scheduled onto. */
    line: number
    /** When work actually begins -- later than queue time if the line is busy. */
    startedAt: number
    doneAt: number
}

export interface ResearchJob {
    id: string
    startedAt: number
    doneAt: number
}

/** Events the simulation emits during a catch-up, surfaced to the player as a feed. */
export interface SimEvent {
    at: number
    kind: 'arrive' | 'harvest' | 'unload' | 'levelup' | 'camp-cleared' | 'camp-failed'
        | 'starved' | 'depleted' | 'refined' | 'researched'
    workerId?: string
    nodeId?: NodeId
    text: string
}
