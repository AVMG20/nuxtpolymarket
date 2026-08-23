import {
    AFFIX_BY_STAT, ALL_RESOURCE_IDS, CATEGORIES, ITEM_SLOTS, MAKES, RECIPES, TIERS, tierRequirement
} from './config'
import { createRng, hashString, type Rng } from './rng'
import { rarityGrowth } from './workers'
import type { CaravanState, ItemSlot, ResourceId, Worker } from './types'

export const STATE_VERSION = 1

/** How many events the persisted feed keeps. */
export const LOG_LIMIT = 60

/**
 * A fresh caravan. The player starts owning the origin capital and a small
 * larder, so the first hire can actually walk somewhere before it gets hungry.
 */
export function createInitialState(userId: string, now: number): CaravanState {
    const resources: Record<ResourceId, number> = {}
    for (const id of ALL_RESOURCE_IDS) resources[id] = 0
    resources.bread = 40

    return {
        version: STATE_VERSION,
        tier: 1,
        lastTick: now,
        rngSeed: hashString(userId) ^ 0x5bf03635,
        rngCursor: 0,
        resources,
        ownedNodes: [0],
        nodeCapacity: {},
        capitals: [0],
        clearedCamps: [],
        roads: {},
        depletion: {},
        workers: [],
        items: [],
        research: [],
        policies: { autoRefine: false, autoSalvageBelow: null },
        charters: 0,
        deeds: 0,
        shards: 0,
        market: { window: 0, purchased: [], refreshes: 0 },
        log: [],
        refineJobs: [],
        researchJob: null,
        pendingGems: 0,
        pendingCoins: 0,
        stats: { totalHauled: 0, hauledValue: 0, tripsCompleted: 0, campsCleared: 0 }
    }
}

/** Fill in anything a save written by an older build is missing. */
export function migrateState(state: CaravanState, userId: string, now: number): CaravanState {
    const base = createInitialState(userId, now)
    const merged: CaravanState = { ...base, ...state }
    merged.resources = { ...base.resources, ...(state.resources ?? {}) }
    merged.stats = { ...base.stats, ...(state.stats ?? {}) }
    merged.policies = { ...base.policies, ...(state.policies ?? {}) }
    merged.nodeCapacity = { ...(state.nodeCapacity ?? {}) }
    merged.market = { ...base.market, ...(state.market ?? {}) }
    merged.log = (state.log ?? []).slice(-LOG_LIMIT)
    merged.refineJobs = state.refineJobs ?? []
    merged.researchJob = state.researchJob ?? null
    merged.pendingGems = state.pendingGems ?? 0
    // Older saves are brought forward rather than reset: specialties are derived
    // from the worker's own id, and the split harvest/power stats fold into the
    // single strength stat that replaced them.
    merged.workers = (state.workers ?? []).map((worker) => {
        const legacy = worker as unknown as { harvest?: number, base?: Record<string, number> }
        const base = worker.base as unknown as Record<string, number>
        return {
            ...worker,
            specialties: worker.specialties ?? [CATEGORIES[hashString(worker.id) % CATEGORIES.length]!],
            growth: worker.growth ?? rarityGrowth(worker.rarity),
            base: {
                speed: base?.speed ?? 0.9,
                carry: base?.carry ?? 20,
                strength: base?.strength ?? legacy.harvest ?? base?.harvest ?? 0.9,
                hunger: base?.hunger ?? 1.1
            },
            // Boots and charms no longer exist; anything in them is dropped back
            // into the vault rather than left dangling on a slot that is gone.
            equipment: Object.fromEntries(
                Object.entries(worker.equipment ?? {}).filter(([slot]) => ITEM_SLOTS.includes(slot as ItemSlot))
            ),
            activity: repairActivity(worker.activity)
        }
    })
    merged.items = (state.items ?? [])
        // Items in retired slots are dropped: keeping them would clutter a vault
        // with things nothing can ever wear.
        .filter(item => ITEM_SLOTS.includes(item.slot))
        .map(item => ({
            ...item,
            make: item.make ?? MAKES[hashString(item.id) % MAKES.length]!.id,
            // Retired affixes are dropped so an old item cannot carry a stat the
            // game no longer reads.
            affixes: (item.affixes ?? []).filter(affix => AFFIX_BY_STAT[affix.stat] !== undefined)
        }))
    merged.version = STATE_VERSION
    return merged
}

/**
 * An activity whose deadline is missing or non-finite can never complete, which
 * strands the worker permanently. Anything unfinishable is reset to idle so the
 * worker picks its posting back up on the next tick.
 */
function repairActivity(activity: Worker['activity'] | undefined): Worker['activity'] {
    if (!activity) return { type: 'idle' }
    const deadline = activity.type === 'travel'
        ? activity.arrivesAt
        : activity.type === 'harvest' || activity.type === 'unload'
            ? activity.doneAt
            : activity.type === 'assault'
                ? activity.resolvesAt
                : 0
    return Number.isFinite(deadline) ? activity : { type: 'idle' }
}

export function hasResources(state: CaravanState, cost: Record<ResourceId, number>): boolean {
    for (const id in cost) {
        if ((state.resources[id] ?? 0) < (cost[id] ?? 0)) return false
    }
    return true
}

export function spendResources(state: CaravanState, cost: Record<ResourceId, number>): void {
    for (const id in cost) {
        state.resources[id] = (state.resources[id] ?? 0) - (cost[id] ?? 0)
    }
}

/** How many batches of a recipe the current stock can cover. */
export function maxBatches(state: CaravanState, recipeId: string): number {
    const recipe = RECIPES.find(r => r.id === recipeId)
    if (!recipe) return 0
    let max = Infinity
    for (const id in recipe.inputs) {
        max = Math.min(max, Math.floor((state.resources[id] ?? 0) / (recipe.inputs[id] ?? 1)))
    }
    return Number.isFinite(max) ? Math.max(0, max) : 0
}

/** Everything standing between the player and the next tier. */
export function tierProgress(state: CaravanState) {
    const req = tierRequirement(state.tier)
    if (!req) return null
    const resources = Object.entries(req.resources).map(([id, need]) => ({
        id,
        need,
        have: state.resources[id] ?? 0
    }))
    return {
        requirement: req,
        nextTier: TIERS[state.tier] ?? null,
        resources,
        nodesOwned: state.ownedNodes.length,
        resourcesMet: resources.every(r => r.have >= r.need),
        nodesMet: state.ownedNodes.length >= req.nodes
    }
}

/**
 * Run a roll against the save's own generator and persist the cursor. Anything
 * random that changes the save has to go through here, so a replay of the same
 * state produces the same outcome on the client as it did on the server.
 */
export function withStateRng<T>(state: CaravanState, fn: (rng: Rng) => T): T {
    const rng = createRng(state.rngSeed, state.rngCursor)
    const out = fn(rng)
    state.rngCursor = rng.cursor()
    return out
}
