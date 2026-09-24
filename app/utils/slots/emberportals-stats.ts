// Ember Portals figures shown in the rules, measured with
// `bun run scripts/slot-rtp.ts emberportals` plus the ante and buy modes.
// Re-measure and update these whenever the math in
// shared/utils/gamelogic/emberportals.ts changes.
export const EP_STATS = {
    rounds: '100 million',
    rtp: 0.978,
    baseRtp: 0.2872,
    freeSpinsRtp: 0.6909,
    anteRtp: 0.9788,
    buyRtp: 0.975,
    /** Share of spins with at least one winning cluster. */
    hitRate: 0.26,
    freeSpinsOdds: 152,
    anteFreeSpinsOdds: 113,
    volatility: 5
} as const
