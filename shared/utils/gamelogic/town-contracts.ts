/**
 * Polytown daily contracts: each UTC day the town hall asks a town for three
 * goods it makes, and pays twice the floor price for them. Delivering all
 * three also pays a small gem bonus, rolled with the contracts.
 *
 * Pure rules only. The server rolls and persists them (server/utils/town-contracts.ts);
 * every random draw goes through an injected `rng` so tests are deterministic.
 */
import { randomFloat, randomWeighted } from '../random'
import {
    TOWN_RESOURCES,
    TOWN_TICK_MS,
    effectiveLevel,
    getTownBuilding,
    isBuilt,
    townFloorPrice,
    townNetPerTick,
    townResourceSoldByDefault,
    townTickRecipe,
    type TownDerived,
    type TownResourceBag,
    type TownResourceId,
    type TownSimBuilding
} from './town'

export type TownContractRng = () => number

export const TOWN_CONTRACT_SLOTS = 3
/** A contract asks for this many hours of the town's current output, picked at random. */
export const TOWN_CONTRACT_MIN_HOURS = 10
export const TOWN_CONTRACT_MAX_HOURS = 18
/**
 * Never less than this share of what the town can store for the good... unless
 * that is more than twice the rolled hours of output: a town with a huge
 * warehouse and a single sawmill gets a stretch, not a week of planks.
 */
export const TOWN_CONTRACT_STORAGE_MIN_SHARE = 0.25
export const TOWN_CONTRACT_MAX_STRETCH = 2
/** Never more than this share of the storage cap, so a full delivery always fits on the shelf. */
export const TOWN_CONTRACT_STORAGE_MAX_SHARE = 0.85
export const TOWN_CONTRACT_MIN_QUANTITY = 10
/** The hall pays this many times the floor price. */
export const TOWN_CONTRACT_REWARD_MULTIPLIER = 2
/**
 * A good the town makes but eats entirely downstream (planks into tools) is
 * sized off this share of its gross output: the mayor has to divert some.
 */
export const TOWN_CONTRACT_CONSUMED_SHARE = 0.25
/** What a town that makes nothing yet is asked for, at one level-1 producer's rate. */
export const TOWN_CONTRACT_FALLBACK_RESOURCES: readonly TownResourceId[] = ['wheat', 'wood', 'stone']
export const TOWN_CONTRACT_FALLBACK_PER_HOUR = 60
/** Old contract days are pruned after this many days. */
export const TOWN_CONTRACT_KEEP_DAYS = 7

/** Gems for delivering all three. Gems are scarce on the site, so the roll leans hard toward one. */
export const TOWN_CONTRACT_BONUS_WEIGHTS: readonly { gems: number, weight: number }[] = [
    { gems: 1, weight: 40 },
    { gems: 2, weight: 25 },
    { gems: 3, weight: 18 },
    { gems: 4, weight: 10 },
    { gems: 5, weight: 7 }
]

const DAY_MS = 24 * 60 * 60_000
const HOUR_MS = 60 * 60_000

// ─── Days ────────────────────────────────────────────────────────────────────

/** UTC day key, 'YYYY-MM-DD'. */
export function townContractDayKey(now: number): string {
    return new Date(now).toISOString().slice(0, 10)
}

/** Epoch ms of the next UTC midnight: when today's contracts expire. */
export function townContractResetAt(now: number): number {
    return Math.floor(now / DAY_MS) * DAY_MS + DAY_MS
}

/** The day key `days` before the one `now` falls on. */
export function townContractDayBefore(now: number, days: number): string {
    return townContractDayKey(Math.floor(now / DAY_MS) * DAY_MS - days * DAY_MS)
}

// ─── Sizing ──────────────────────────────────────────────────────────────────

/**
 * Round to `digits` significant figures: 12_345 → 12_000, 987 → 990. Whole
 * numbers only, so 7.4 is 7. `floor` rounds down instead.
 */
export function roundToSignificant(value: number, digits = 2, floor = false): number {
    if (!Number.isFinite(value) || value <= 0) return 0
    const magnitude = Math.floor(Math.log10(value))
    const step = 10 ** Math.max(0, magnitude - digits + 1)
    return (floor ? Math.floor(value / step) : Math.round(value / step)) * step
}

/**
 * Units of a good to ask for. `perHour` is what the town makes of it now,
 * `storageCap` how much of it the town can hold.
 */
export function townContractQuantity(perHour: number, storageCap: number, rng: TownContractRng = randomFloat): number {
    const hours = TOWN_CONTRACT_MIN_HOURS + rng() * (TOWN_CONTRACT_MAX_HOURS - TOWN_CONTRACT_MIN_HOURS)
    const raw = Math.max(0, perHour) * hours
    const upper = storageCap * TOWN_CONTRACT_STORAGE_MAX_SHARE
    const lower = Math.min(storageCap * TOWN_CONTRACT_STORAGE_MIN_SHARE, raw * TOWN_CONTRACT_MAX_STRETCH)
    const sized = Math.min(upper, Math.max(lower, raw))
    let rounded = roundToSignificant(sized, 2)
    if (rounded > upper) rounded = roundToSignificant(sized, 2, true)
    return Math.max(TOWN_CONTRACT_MIN_QUANTITY, Math.min(rounded, Math.floor(storageCap)))
}

/** Coins the hall pays for a contract: twice what the floor would. */
export function townContractReward(resource: TownResourceId, quantity: number): number {
    return Math.round(quantity * townFloorPrice(resource) * TOWN_CONTRACT_REWARD_MULTIPLIER * 100) / 100
}

/** What the same goods fetch at the floor. */
export function townContractFloorValue(resource: TownResourceId, quantity: number): number {
    return Math.round(quantity * townFloorPrice(resource) * 100) / 100
}

export function townContractBonusGems(rng: TownContractRng = randomFloat): number {
    return randomWeighted(TOWN_CONTRACT_BONUS_WEIGHTS, w => w.weight, rng).gems
}

// ─── Rates ───────────────────────────────────────────────────────────────────

export interface TownContractRates {
    /** Net units per hour after inputs and townsfolk's needs. */
    net: TownResourceBag
    /** Units per hour the workshops turn out, before anything consumes them. */
    gross: TownResourceBag
}

/** The town's current hourly output, at today's staffing, supply and mood. */
export function townContractRates(buildings: TownSimBuilding[], derived: TownDerived, now: number): TownContractRates {
    const ticksPerHour = HOUR_MS / TOWN_TICK_MS * derived.speedMultiplier
    const net: TownResourceBag = {}
    for (const [id, qty] of Object.entries(townNetPerTick(buildings, derived, now)) as [TownResourceId, number][]) {
        net[id] = qty * ticksPerHour
    }
    const gross: TownResourceBag = {}
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const def = getTownBuilding(b.type)
        if (!def || def.kind !== 'industry') continue
        const recipe = townTickRecipe(def, effectiveLevel(b, now), derived.throughput.get(b.id) ?? 0)
        if (!recipe) continue
        for (const [id, qty] of Object.entries(recipe.outputs) as [TownResourceId, number][]) {
            gross[id] = (gross[id] ?? 0) + qty * ticksPerHour
        }
    }
    return { net, gross }
}

export interface TownContractCandidate {
    resource: TownResourceId
    perHour: number
}

/** Goods the hall may ask for: sellable ones the town makes, with the rate to size them by. */
export function townContractCandidates(rates: TownContractRates): TownContractCandidate[] {
    const out: TownContractCandidate[] = []
    for (const r of TOWN_RESOURCES) {
        if (!townResourceSoldByDefault(r.id) || r.floorPrice <= 0) continue
        const net = rates.net[r.id] ?? 0
        const gross = rates.gross[r.id] ?? 0
        if (net > 0) out.push({ resource: r.id, perHour: net })
        else if (gross > 0) out.push({ resource: r.id, perHour: gross * TOWN_CONTRACT_CONSUMED_SHARE })
    }
    return out
}

function takeRandom<T>(pool: T[], rng: TownContractRng): T {
    const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length))
    return pool.splice(index, 1)[0]!
}

export interface TownContractRoll {
    slot: number
    resource: TownResourceId
    quantity: number
    reward: number
}

/**
 * The day's three contracts and the gem bonus. Three different goods, picked
 * from what the town makes; a town that makes fewer than three is topped up
 * from the raw goods every town can start on.
 */
export function rollTownContracts(
    rates: TownContractRates,
    storageCap: number,
    rng: TownContractRng = randomFloat
): { contracts: TownContractRoll[], bonusGems: number } {
    const pool = townContractCandidates(rates)
    const picked: TownContractCandidate[] = []
    while (picked.length < TOWN_CONTRACT_SLOTS && pool.length > 0) picked.push(takeRandom(pool, rng))

    const fallback = TOWN_CONTRACT_FALLBACK_RESOURCES
        .filter(id => !picked.some(p => p.resource === id))
        .map(resource => ({ resource, perHour: TOWN_CONTRACT_FALLBACK_PER_HOUR }))
    while (picked.length < TOWN_CONTRACT_SLOTS && fallback.length > 0) picked.push(takeRandom(fallback, rng))

    const contracts = picked.map((c, slot) => {
        const quantity = townContractQuantity(c.perHour, storageCap, rng)
        return { slot, resource: c.resource, quantity, reward: townContractReward(c.resource, quantity) }
    })
    return { contracts, bonusGems: townContractBonusGems(rng) }
}
