// ─── Base price ───────────────────────────────────────────────────────────────
export const GEM_INITIAL_PRICE = 300        // $ per gem on first launch

// ─── Time-based growth ────────────────────────────────────────────────────────
export const GEM_HOURLY_GROWTH_RATE = 0.005    // base +0.5% per hour

// ─── Trade impact (exponential, split-proof) ─────────────────────────────────
// A max-size trade moves the market price by ±TRADE_IMPACT_MAX.
// Uses an exponential price curve during the trade so that splitting a trade
// into smaller pieces gives the exact same cost/revenue and final price.
export const GEM_TRADE_IMPACT_MAX = 0.50   // 50% for a max-size trade

// ─── Transaction fee ──────────────────────────────────────────────────────────
// Flat fee on every trade. Ensures round-trips always lose money while keeping
// the market price perfectly reversible (buy N then sell N → price unchanged).
export const GEM_TRADE_FEE = 0.005            // 0.5% fee

// ─── Mean-reversion (growth only, never trade impact) ─────────────────────────
export const GEM_REVERSION_CAP = 2.5          // floor/ceiling on growth multiplier

// ─── Hard limits ──────────────────────────────────────────────────────────────
export const GEM_MAX_PRICE = 1_000_000
export const GEM_MIN_PRICE = 0.01
export const GEM_MAX_GEMS_PER_TRADE = 50

// ─── History ──────────────────────────────────────────────────────────────────
export const GEM_HISTORY_DAYS = 30
export const GEM_HISTORY_LIMIT = 200

// ─── Derived constant ─────────────────────────────────────────────────────────
// Exponential rate per gem: calibrated so a max-size trade moves price by
// exactly GEM_TRADE_IMPACT_MAX.
const GEM_K = Math.log(1 + GEM_TRADE_IMPACT_MAX) / GEM_MAX_GEMS_PER_TRADE

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampGemPrice(p: number): number {
    return Math.min(Math.max(p, GEM_MIN_PRICE), GEM_MAX_PRICE)
}

/**
 * Effective hourly growth rate at the given price.
 * Below base → amplified (faster recovery).
 * Above base → dampened (natural brake).
 * Capped at ±GEM_REVERSION_CAP so it never explodes.
 */
export function gemEffectiveGrowthRate(currentPrice: number): number {
    const mult = Math.pow(GEM_INITIAL_PRICE / currentPrice, 1.5)
    const capped = Math.min(mult, GEM_REVERSION_CAP)
    return GEM_HOURLY_GROWTH_RATE * capped
}

/**
 * Step a price forward by `hoursElapsed`, recalculating the growth rate
 * each hour so mean-reversion stays accurate over long time gaps.
 * Safe to call on both server and client.
 */
export function gemStepPrice(fromPrice: number, hoursElapsed: number): number {
    if (hoursElapsed <= 0) return clampGemPrice(fromPrice)
    let price = fromPrice
    let remaining = hoursElapsed
    while (remaining > 0) {
        const dt = Math.min(remaining, 1)
        price = price * Math.pow(1 + gemEffectiveGrowthRate(price), dt)
        remaining -= dt
    }
    return clampGemPrice(price)
}

/** Compute the live price from a stored price + last-update timestamp. */
export function gemComputeLivePrice(storedPrice: number, lastUpdatedAt: Date): number {
    const hoursElapsed = (Date.now() - lastUpdatedAt.getTime()) / 3_600_000
    return gemStepPrice(storedPrice, hoursElapsed)
}

/**
 * Buy N gems. Returns the total cost (what the buyer pays) and the new
 * market price after the trade.
 *
 * The price rises exponentially during the trade:
 *   price(g) = startPrice × e^(K × g)
 *
 * Total cost = integral from 0 to N, plus fee.
 * Splitting gives the exact same result — no advantage to many small trades.
 */
export function gemBuyGems(
    price: number,
    gems: number,
): { cost: number; newPrice: number } {
    const newPrice = clampGemPrice(price * Math.exp(GEM_K * gems))
    const rawCost = price * (Math.exp(GEM_K * gems) - 1) / GEM_K
    const cost = rawCost * (1 + GEM_TRADE_FEE)
    return { cost, newPrice }
}

/**
 * Sell N gems. Returns the total revenue (what the seller receives) and
 * the new market price after the trade.
 *
 * The price falls exponentially during the trade:
 *   price(g) = startPrice × e^(-K × g)
 *
 * Total revenue = integral from 0 to N, minus fee.
 * Splitting gives the exact same result — no advantage to many small trades.
 */
export function gemSellGems(
    price: number,
    gems: number,
): { revenue: number; newPrice: number } {
    const newPrice = clampGemPrice(price * Math.exp(-GEM_K * gems))
    const rawRevenue = price * (1 - Math.exp(-GEM_K * gems)) / GEM_K
    const revenue = rawRevenue * (1 - GEM_TRADE_FEE)
    return { revenue, newPrice }
}
