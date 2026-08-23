import {
    BASE_MARKET_SLOTS,
    MARKET_REFRESH_GEMS,
    MARKET_OVERTIER_CHANCE,
    MARKET_WINDOW_MS,
    MAX_TIER,
    RARITIES,
    recruitPrice
} from './config'
import { seededRng } from './rng'
import { createWorker, workerQuality } from './workers'
import type { Bonuses } from './progression'
import type { CaravanState, Worker } from './types'

/**
 * The recruitment market.
 *
 * The slate turns over every twelve hours, and it is derived rather than stored:
 * the window index falls out of the clock, and every recruit on it is generated
 * from (save seed, window, slot). That means no cron job, no background writes,
 * and a slate that is identical whether you look at it on the server or predict
 * it on the client. Only which slots have been bought is persisted.
 */

export interface Recruit {
    slot: number
    worker: Worker
    price: number
    /** True when this one rolled a tier above the player -- the reason to check back. */
    overTier: boolean
    purchased: boolean
}

/** Which twelve-hour slate `now` falls in. */
export function marketWindow(now: number): number {
    return Math.floor(now / MARKET_WINDOW_MS)
}

/** Epoch ms at which the current slate is replaced. */
export function marketRefreshAt(now: number): number {
    return (marketWindow(now) + 1) * MARKET_WINDOW_MS
}

export function marketSlots(bonuses: Bonuses): number {
    return BASE_MARKET_SLOTS + bonuses.marketSlots
}

/** Gems to tear up the current slate and post a new one immediately. */
export const REFRESH_COST = MARKET_REFRESH_GEMS

/**
 * Build the slate for a window. Deterministic for a given save and window, so
 * the price a player is quoted is the price the server charges.
 */
export function generateMarket(state: CaravanState, bonuses: Bonuses, now: number): Recruit[] {
    const window = marketWindow(now)
    const slots = marketSlots(bonuses)
    const sameWindow = state.market?.window === window
    const purchased = sameWindow ? state.market.purchased : []
    // Gem refreshes reseed the slate without waiting for the clock.
    const refreshes = sameWindow ? (state.market.refreshes ?? 0) : 0
    const recruits: Recruit[] = []

    for (let slot = 0; slot < slots; slot++) {
        const rng = seededRng(state.rngSeed, window, refreshes, slot, 'market')
        // A small chance of a recruit from the tier above is what makes checking
        // the slate worth doing rather than something you skim past.
        const overTier = state.tier < MAX_TIER && rng.chance(MARKET_OVERTIER_CHANCE)
        const tier = overTier ? state.tier + 1 : state.tier
        const worker = createWorker(rng, tier, now + slot)
        const rarityIndex = RARITIES.findIndex(r => r.id === worker.rarity)

        recruits.push({
            slot,
            worker,
            price: recruitPrice(tier, rarityIndex, workerQuality(worker)),
            overTier,
            purchased: purchased.includes(slot)
        })
    }

    return recruits
}
