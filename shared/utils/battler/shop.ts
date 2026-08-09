/**
 * Battler tuning (§12.2, §12.4). Every number here is a starting value the
 * design doc explicitly expects to move once real players lean on it.
 */

export const BATTLER = {
    /** Board: slot 0 is the active shield, 1–5 the bench artillery (§12.5). */
    boardSlots: 6,
    /** Draft: distinct cards drawn per run, weighted copies² (§12.2). */
    draftUnits: 10,
    /** Instances a drafted card enters with: min(copies, this). */
    maxInstances: 6,
    /** Escalating merge thresholds: instances → level (§12.2). */
    levelThresholds: { 2: 3, 3: 6 } as Record<number, number>,
    /** Sub-linear level multipliers on HP and attack (§12.3). */
    levelMultiplier: { 1: 1, 2: 1.8, 3: 3.0 } as Record<number, number>,
    /** ₱ per shop phase: min(9 + round, 15) (§12.4). */
    cashFor: (round: number) => Math.min(9 + round, 15),
    /** Unit track width grows as stakes rise (§12.4). */
    trackWidthFor: (round: number) => round <= 3 ? 3 : round <= 6 ? 4 : 5,
    rerollCost: 1,
    /** Sell refunds cost − 1 (§12.4). */
    sellRefund: (cost: number) => Math.max(0, cost - 1),
    /** Reposition budget per shop phase; each move costs the unit's retreat. */
    repositionBudget: 2,
    /** Run ladder (§12.5). */
    maxLosses: 3,
    winsToComplete: 10,
    roundCap: 30
} as const

/**
 * ₱ cost by tier (§12.4 defaults). The primary vocabulary is thepricedex
 * pull-rate tier the import stores in raw.pullRate.tier — normalized labels
 * that even the legacy sets carry. The regex fallback catches cards whose
 * pull-rate row never arrived and prices unknowns as a plain Rare.
 */
const TIER_COST: Record<string, number> = {
    'Common': 3,
    'Uncommon': 3,
    'Rare': 4,
    'Rare Holo': 4,
    'Double Rare': 6,
    'Ultra Rare': 8,
    'Illustration Rare': 8,
    'Special Illustration Rare': 8,
    'Shining Rare': 8,
    'Secret Rare': 8,
    'Hyper Rare': 10,
    'Mega Hyper Rare': 10,
    'Mega Attack Rare': 10,
    'ACE SPEC Rare': 5
}

export function unitCostFor(tierOrRarity: string | null): number {
    if (!tierOrRarity) return 4
    // "Reverse Common" and friends price as their base tier.
    const label = tierOrRarity.replace(/^Reverse /, '')
    const exact = TIER_COST[label]
    if (exact !== undefined) return exact
    const lowered = label.toLowerCase()
    if (/hyper|mega|gold|rainbow/.test(lowered)) return 10
    if (/ultra|illustration|special|full ?art|shining|secret/.test(lowered)) return 8
    if (/double|^2r$|^rr$|holo v|vmax|vstar/.test(lowered)) return 6
    if (/rare|^r$/.test(lowered)) return 4
    if (/common|uncommon|^c$|^u$/.test(lowered)) return 3
    return 4
}

export function levelFor(instances: number): number {
    if (instances >= BATTLER.levelThresholds[3]!) return 3
    if (instances >= BATTLER.levelThresholds[2]!) return 2
    return 1
}
