// Trash Panda Heist figures shown in the rules, measured with
// `bun run scripts/slot-rtp.ts trashpanda` (20M spins) and the two buy modes
// (2M rounds each). Re-measure and update these whenever the math in
// shared/utils/gamelogic/trashpanda.ts changes.
export const TPH_STATS = {
    rounds: '20 million',
    rtp: 0.9741,
    baseRtp: 0.3132,
    diveRtp: 0.1693,
    /** Scatter-triggered plus golden-key free spins. */
    freeSpinsRtp: 0.4916,
    buyFreeSpinsRtp: 0.9753,
    buyDiveRtp: 0.9741,
    /** Share of spins that pay anything. */
    hitRate: 0.444,
    diveOdds: 100,
    freeSpinsOdds: 255,
    volatility: 4
} as const
