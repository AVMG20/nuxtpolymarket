// Trash Panda Heist figures shown in the rules, measured with
// `bun run scripts/slot-rtp.ts trashpanda` (20M spins) and the two buy modes
// (2M rounds each). Re-measure and update these whenever the math in
// shared/utils/gamelogic/trashpanda.ts changes.
export const TPH_STATS = {
    rounds: '20 million',
    rtp: 0.9812,
    baseRtp: 0.3315,
    diveRtp: 0.1461,
    /** Scatter-triggered plus golden-key free spins. */
    freeSpinsRtp: 0.5036,
    buyFreeSpinsRtp: 0.9757,
    buyDiveRtp: 0.9768,
    /** Share of spins that pay anything. */
    hitRate: 0.46,
    diveOdds: 116,
    freeSpinsOdds: 246,
    volatility: 4
} as const
