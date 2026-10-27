import { getTownBuilding, townLevelCost } from './town'

// The builders popover's "recommended upgrades". Every open upgrade gets a
// score from what the town needs most right now, and the best few are the
// suggestions. Order of need: homes while jobs outnumber (or are about to
// outnumber) residents, then goods the town is running out of, then mood,
// storage and plain growth. Advice only: nothing here spends or grants value.

/** Suggestions the popover shows. */
export const TOWN_ADVISOR_PICKS = 5

/** Spare residents below this share of the town counts as "about to run short". */
const RESIDENTS_MARGIN = 0.1
/** A good at this share of the storage cap is piling up. */
const STORAGE_FULL = 0.9

export type TownAdviceReason = 'residents' | 'short' | 'happiness' | 'storage'

export interface TownAdvisorState {
    /** Workers every building wants. */
    jobs: number
    /** Residents the homes hold. */
    residents: number
    /** 0..100. */
    happiness: number
    /** Per-good storage cap. */
    storageCap: number
    /** Net change per hour of every good the town makes or uses. */
    netPerHour: Record<string, number>
    stock: Record<string, number>
}

export interface TownAdvisorCandidate {
    type: string
    level: number
    affordable: boolean
}

export type TownAdvice<C extends TownAdvisorCandidate> = C & {
    score: number
    reason?: TownAdviceReason
    /** The good this upgrade fixes, with reason `short`. */
    resource?: string
}

function isFull(state: TownAdvisorState, id: string) {
    return state.storageCap > 0 && (state.stock[id] ?? 0) >= state.storageCap * STORAGE_FULL
        && (state.netPerHour[id] ?? 0) >= 0
}

/** How badly the town needs one more level of this building, with the main reason. */
export function scoreTownUpgrade(state: TownAdvisorState, c: TownAdvisorCandidate): { score: number, reason?: TownAdviceReason, resource?: string } {
    const def = getTownBuilding(c.type)
    if (!def || def.kind === 'road') return { score: -Infinity }

    const spare = state.residents - state.jobs
    const shortOfWorkers = spare < 0
    const nearlyShort = !shortOfWorkers && spare <= Math.max(2, state.residents * RESIDENTS_MARGIN)
    let score = 0
    let reason: TownAdviceReason | undefined
    let resource: string | undefined

    if (def.kind === 'housing') {
        if (shortOfWorkers) {
            score = 1000 + Math.min(200, -spare * 10)
            reason = 'residents'
        } else if (nearlyShort) {
            score = 600
            reason = 'residents'
        } else {
            score = 40
        }
    } else if (def.kind === 'industry') {
        // Worst shortfall this building makes: out of stock beats running low.
        let urgency = 0
        for (const id of Object.keys(def.outputs)) {
            const net = state.netPerHour[id] ?? 0
            if (net >= 0) continue
            const hoursLeft = (state.stock[id] ?? 0) / -net
            const u = hoursLeft < 1 ? 900 : hoursLeft < 6 ? 800 : 700
            if (u > urgency) {
                urgency = u
                resource = id
            }
        }
        if (resource) {
            score = urgency
            reason = 'short'
        } else {
            score = 100 + def.tier * 25
            // Output already piling up at the cap earns nothing more.
            const outs = Object.keys(def.outputs)
            if (outs.length > 0 && outs.every(id => isFull(state, id))) score -= 300
        }
        // More of a good the town is already running down only drains it faster.
        if (Object.keys(def.inputs).some(id => (state.netPerHour[id] ?? 0) < 0)) score -= 250
        // Extra jobs nobody can fill.
        const added = def.workersPerLevel ?? def.workers
        if (shortOfWorkers) score -= 300
        else if (added > spare) score -= 120
    } else if (def.kind === 'civic') {
        if (state.happiness < 50) {
            score = 500 + (50 - state.happiness) * 6
            reason = 'happiness'
        } else if (state.happiness < 75) {
            score = 200 + (75 - state.happiness) * 4
            reason = 'happiness'
        } else {
            score = 30
        }
    } else if (def.kind === 'storage') {
        const full = Object.keys(state.stock).filter(id => isFull(state, id)).length
        if (full > 0) {
            score = 450 + Math.min(5, full) * 40
            reason = 'storage'
        } else {
            score = 20
        }
    }

    if (!c.affordable) score -= 250
    // The cheaper rung wins a tie.
    score -= c.level
    return { score, reason, resource }
}

/** The best upgrades for the town, best first; ties keep the input's order. */
export function rankTownUpgrades<C extends TownAdvisorCandidate>(state: TownAdvisorState, candidates: C[], count = TOWN_ADVISOR_PICKS): TownAdvice<C>[] {
    return candidates
        .map((c, i) => ({ c, i, advice: scoreTownUpgrade(state, c) }))
        .filter(r => Number.isFinite(r.advice.score))
        .sort((a, b) => b.advice.score - a.advice.score || a.i - b.i)
        .slice(0, count)
        .map(r => ({ ...r.c, ...r.advice }))
}

/** How each reason reads next to a suggestion; `short` follows the good's name. */
export const TOWN_ADVICE_LABELS: Record<TownAdviceReason, string> = {
    residents: 'Residents',
    short: 'short',
    happiness: 'Mood',
    storage: 'Storage'
}

export interface TownUpgradeBuilding {
    id: string
    type: string
    level: number
    upgradingTo: number | null
    completesAt: number
}

export interface TownUpgradeCatalogEntry {
    name: string
    kind: string
    tier: number
    maxLevel?: number
}

export type TownUpgradeCost = ReturnType<typeof townLevelCost>

export interface TownUpgradeCandidate extends TownAdvisorCandidate {
    id: string
    name: string
    tier: number
    cost: TownUpgradeCost
}

/**
 * Every upgrade a free crew could take, one row per building type: its lowest
 * level, the cheapest rung. Six houses in a row is not six recommendations.
 */
export function townUpgradeCandidates(
    buildings: readonly TownUpgradeBuilding[],
    catalog: ReadonlyMap<string, TownUpgradeCatalogEntry>,
    maxLevel: number,
    now: number,
    canAfford: (cost: TownUpgradeCost) => boolean
): TownUpgradeCandidate[] {
    const rows: TownUpgradeCandidate[] = []
    for (const b of buildings) {
        const entry = catalog.get(b.type)
        const def = getTownBuilding(b.type)
        if (!entry || !def || entry.kind === 'road' || entry.kind === 'monument') continue
        if (b.level <= 0 || b.upgradingTo !== null || b.completesAt > now) continue
        if (b.level >= (entry.maxLevel ?? maxLevel)) continue
        const cost = townLevelCost(def, b.level + 1)
        rows.push({ id: b.id, type: b.type, name: entry.name, level: b.level, tier: entry.tier, affordable: canAfford(cost), cost })
    }
    rows.sort((a, b) => a.tier - b.tier || a.level - b.level)
    const seen = new Set<string>()
    return rows.filter(r => !seen.has(r.type) && seen.add(r.type))
}

/**
 * Net units per tick with a production surge counted in. A surge multiplies
 * what the workshops make and use, never what the townsfolk eat, so the needs
 * come off the base net, the rest scales, and they go back on.
 */
export function townBoostedNet(
    net: Readonly<Record<string, number>>,
    needs: readonly { resource: string, perTick: number, active: boolean }[],
    productionMultiplier: number
): Record<string, number> {
    if (productionMultiplier === 1) return { ...net }
    const eaten: Record<string, number> = {}
    for (const n of needs) {
        if (n.active) eaten[n.resource] = (eaten[n.resource] ?? 0) + n.perTick
    }
    const out: Record<string, number> = {}
    for (const id of new Set([...Object.keys(net), ...Object.keys(eaten)])) {
        const e = eaten[id] ?? 0
        out[id] = ((net[id] ?? 0) + e) * productionMultiplier - e
    }
    return out
}

/** Whether coins and stock cover a cost. */
export function townCanAfford(cost: TownUpgradeCost, coins: number, stock: Readonly<Record<string, number>>): boolean {
    if (coins < cost.coins) return false
    return Object.entries(cost.resources).every(([id, q]) => (stock[id] ?? 0) >= (q ?? 0))
}

/** Production ticks per real hour at the town's mood speed. */
export function townTicksPerHour(tickMs: number, speedMultiplier = 0.75): number {
    return (3_600_000 / tickMs) * speedMultiplier
}
