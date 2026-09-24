// Ember Portals figures shown in the rules, measured with
// `bun run scripts/slot-rtp.ts emberportals` plus the ante and buy modes.
// Re-measure and update these whenever the math in
// shared/utils/gamelogic/emberportals.ts changes.
export const EP_STATS = {
    rounds: '100 million',
    rtp: 0.977,
    baseRtp: 0.5463,
    freeSpinsRtp: 0.4307,
    anteRtp: 0.9793,
    buyRtp: 0.9799,
    /** Share of spins with at least one winning cluster. */
    hitRate: 0.26,
    freeSpinsOdds: 235,
    anteFreeSpinsOdds: 150,
    volatility: 4
} as const
