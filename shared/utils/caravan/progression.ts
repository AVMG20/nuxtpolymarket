import { BASE_MAX_CAPITALS, BASE_MAX_WORKERS, RESEARCH_BY_ID } from './config'
import type { CaravanState } from './types'

/** Everything research changes about the run, folded into one object. */
export interface Bonuses {
    maxWorkers: number
    maxCapitals: number
    /** Additive percentages, applied on top of item affixes. */
    speed: number
    carry: number
    strength: number
    /** Extra refinery lines and speed, and research speed. */
    refineryLines: number
    refineSpeed: number
    researchSpeed: number
    hungerRate: number
    coinYield: number
    regenRate: number
    autoFeed: boolean
    /** Extra workers every node can hold at once. */
    nodeCapacity: number
    /** Extra recruits on the market slate. */
    marketSlots: number
    canAutoRefine: boolean
}

export function computeBonuses(research: string[]): Bonuses {
    const b: Bonuses = {
        maxWorkers: BASE_MAX_WORKERS,
        maxCapitals: BASE_MAX_CAPITALS,
        speed: 0,
        carry: 0,
        strength: 0,
        refineryLines: 0,
        refineSpeed: 0,
        researchSpeed: 0,
        hungerRate: 0,
        coinYield: 0,
        regenRate: 0,
        autoFeed: false,
        nodeCapacity: 0,
        marketSlots: 0,
        canAutoRefine: false
    }
    for (const id of research) {
        const def = RESEARCH_BY_ID[id]
        if (!def) continue
        const e = def.effect
        switch (e.kind) {
            case 'maxWorkers': b.maxWorkers += e.amount; break
            case 'maxCapitals': b.maxCapitals += e.amount; break
            case 'globalSpeed': b.speed += e.amount; break
            case 'globalCarry': b.carry += e.amount; break
            case 'globalStrength': b.strength += e.amount; break
            case 'refineryLines': b.refineryLines += e.amount; break
            case 'refineSpeed': b.refineSpeed += e.amount; break
            case 'researchSpeed': b.researchSpeed += e.amount; break
            case 'hungerRate': b.hungerRate += e.amount; break
            case 'coinYield': b.coinYield += e.amount; break
            case 'regenRate': b.regenRate += e.amount; break
            case 'autoFeed': b.autoFeed = true; break
            case 'nodeCapacity': b.nodeCapacity += e.amount; break
            case 'marketSlots': b.marketSlots += e.amount; break
            case 'autoRefine': b.canAutoRefine = true; break
        }
    }
    return b
}

/** Research plus anything gems have permanently added to the caps. */
export function bonusesFor(state: CaravanState): Bonuses {
    const bonuses = computeBonuses(state.research)
    bonuses.maxWorkers += state.charters ?? 0
    bonuses.maxCapitals += state.deeds ?? 0
    return bonuses
}

/** Research the player can see right now, given their tier and what they own. */
export function researchAvailable(state: CaravanState, id: string): { ok: boolean, reason?: string } {
    const def = RESEARCH_BY_ID[id]
    if (!def) return { ok: false, reason: 'Unknown research' }
    if (state.research.includes(id)) return { ok: false, reason: 'Already researched' }
    if (state.tier < def.tier) return { ok: false, reason: `Requires ${def.tier > 1 ? `tier ${def.tier}` : 'tier 1'}` }
    for (const req of def.requires ?? []) {
        if (!state.research.includes(req)) {
            return { ok: false, reason: `Requires ${RESEARCH_BY_ID[req]?.name ?? req}` }
        }
    }
    return { ok: true }
}
