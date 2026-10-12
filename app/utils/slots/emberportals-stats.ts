// Ember Portals figures shown in the rules, measured with
// `bun run scripts/slot-rtp.ts emberportals` plus the ante and buy modes.
// Re-measure and update these whenever the math in
// shared/utils/gamelogic/emberportals.ts changes.
export const EP_STATS = {
    rounds: '56 million',
    rtp: 0.975,
    baseRtp: 0.2875,
    freeSpinsRtp: 0.6877,
    anteRtp: 0.977,
    buyRtp: 0.975,
    /** Share of spins with at least one winning cluster. */
    hitRate: 0.27,
    freeSpinsOdds: 160,
    anteFreeSpinsOdds: 119,
    volatility: 5
} as const
