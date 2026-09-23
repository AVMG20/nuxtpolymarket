import { getTownBuilding } from './town'

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
