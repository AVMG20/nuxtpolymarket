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
    /** Trainers drafted alongside units (§12.6): 6 distinct, 4 deep. */
    draftItems: 6,
    itemInstances: 4,
    itemTrackWidth: 2,
    /** Escalating merge thresholds: instances → level (§12.2). */
    levelThresholds: { 2: 3, 3: 6 } as Record<number, number>,
    /** Level multipliers on HP and attack. Sim-tuned (2026-08): merging N
     *  copies must at least match fielding them separately, or stacking is
     *  a trap — bench bodies all attack, so the merged unit needs to beat
     *  the spread's summed output. 2.6/5.5 puts merged-vs-spread near 60%. */
    levelMultiplier: { 1: 1, 2: 2.6, 3: 5.5 } as Record<number, number>,
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

/**
 * Damage per charge point, keyed by the ₱ cost tier. Printed damage text is
 * untrustworthy (variable "10+" attacks, coin flips, era inflation), so DPS
 * follows the card's price tier and burstiness follows the printed energy
 * cost: same tier, a 1-cost chips every round, a 4-cost lands one nuke.
 */
const DAMAGE_PER_CHARGE: Record<number, number> = {
    3: 1,
    4: 1.5,
    5: 1.75,
    6: 2,
    8: 2.5,
    10: 3
}

export function damagePerChargeFor(tierOrRarity: string | null): number {
    return DAMAGE_PER_CHARGE[unitCostFor(tierOrRarity)] ?? 1.5
}

export function unitCostFor(tierOrRarity: string | null): number {
    if (!tierOrRarity) return 4
    // "Reverse Common" and friends price as their base tier.
    const label = tierOrRarity.replace(/^Reverse /, '')
    const exact = TIER_COST[label]
    if (exact !== undefined) return exact
    const lowered = label.toLowerCase()
    if (/hyper|mega|gold|rainbow|^bwr$/.test(lowered)) return 10
    if (/ultra|illustration|special|full ?art|shining|secret|^chv$|^csr$/.test(lowered)) return 8
    if (/double|^2r$|^rr$|^chr$|holo v|vmax|vstar/.test(lowered)) return 6
    if (/rare|^r$/.test(lowered)) return 4
    if (/common|uncommon|^c$|^u$/.test(lowered)) return 3
    return 4
}

export function levelFor(instances: number): number {
    if (instances >= BATTLER.levelThresholds[3]!) return 3
    if (instances >= BATTLER.levelThresholds[2]!) return 2
    return 1
}
