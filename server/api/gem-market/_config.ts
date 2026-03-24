// ─── Base price ───────────────────────────────────────────────────────────────
export const INITIAL_PRICE = 350              // $ per gem on first launch

// ─── Time-based growth ────────────────────────────────────────────────────────
export const HOURLY_GROWTH_RATE = 0.01        // base +1% per hour

// ─── Trade impact ─────────────────────────────────────────────────────────────
// A full 50-gem trade moves the price by ±10%.
// Perfectly symmetric so round-trips always lose value: (1+x)(1-x) = 1-x² < 1.
export const TRADE_IMPACT_MAX = 0.10          // ±10% for a max-size trade

// ─── Growth-based mean reversion ──────────────────────────────────────────────
// When price is BELOW base → growth is amplified  (faster recovery)
// When price is ABOVE base → growth is dampened   (natural brake)
// Reversion lives ONLY in the growth rate, never in trade impact.
// This ensures trades are exploit-proof while the market still self-corrects.
export const REVERSION_CAP = 2.5              // max/min growth multiplier

// ─── Limits ───────────────────────────────────────────────────────────────────
export const MAX_GEM_PRICE = 1_000_000        // hard cap $1M per gem
export const MIN_GEM_PRICE = 0.01             // floor $0.01 per gem
export const MAX_GEMS_PER_TRADE = 50          // max gems in a single trade
export const HISTORY_DAYS = 30                // chart window in days
export const HISTORY_LIMIT = 200              // max history rows within that window

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampPrice(p: number): number {
    return Math.min(Math.max(p, MIN_GEM_PRICE), MAX_GEM_PRICE)
}

/**
 * Effective hourly growth rate, adjusted by distance from base price.
 *
 *   Price below base → multiplier > 1 → faster growth  (pushes back up)
 *   Price at base    → multiplier = 1 → normal 1%/hr
 *   Price above base → multiplier < 1 → slower growth  (natural brake)
 *
 * Examples at base $350:
 *   $50  → 2.50%/hr (capped at 2.5×)
 *   $100 → 1.87%/hr
 *   $350 → 1.00%/hr
 *   $700 → 0.71%/hr
 *   $10k → 0.40%/hr (floored at 1/2.5×)
 */
export function effectiveGrowthRate(currentPrice: number): number {
    const ratio = INITIAL_PRICE / currentPrice
    const mult = Math.sqrt(ratio)
    const capped = Math.min(Math.max(mult, 1 / REVERSION_CAP), REVERSION_CAP)
    return HOURLY_GROWTH_RATE * capped
}

/**
 * Price after continuous growth since lastUpdatedAt.
 *
 * Steps in 1-hour increments so the growth rate adjusts as the price
 * moves — important when a long time has passed since the last update.
 */
export function computeLivePrice(storedPrice: number, lastUpdatedAt: Date): number {
    const hoursElapsed = (Date.now() - lastUpdatedAt.getTime()) / 3_600_000
    if (hoursElapsed <= 0) return clampPrice(storedPrice)

    let price = storedPrice
    let remaining = hoursElapsed

    while (remaining > 0) {
        const dt = Math.min(remaining, 1) // step size: 1 hour max
        const rate = effectiveGrowthRate(price)
        price = price * Math.pow(1 + rate, dt)
        remaining -= dt
    }

    return clampPrice(price)
}

/**
 * Price after buying N gems → price goes UP.
 *
 * Impact is a flat percentage based on trade size. No reversion modifier —
 * this keeps round-trips always unprofitable at any price level.
 *
 * 50 gems → +10%, 25 gems → +5%, 10 gems → +2%, 1 gem → +0.2%
 */
export function applyBuyImpact(price: number, gems: number): number {
    const fraction = gems / MAX_GEMS_PER_TRADE
    const impact = TRADE_IMPACT_MAX * fraction
    return clampPrice(price * (1 + impact))
}

/**
 * Price after selling N gems → price goes DOWN.
 *
 * Symmetric with applyBuyImpact so that:
 *   buy(sell(price, n), n)  < price   always
 *   sell(buy(price, n), n)  < price   always
 *
 * Round-trip loss = x² where x = TRADE_IMPACT_MAX × fraction.
 * For 50 gems: (1.10)(0.90) = 0.99 → 1% loss per cycle.
 */
export function applySellImpact(price: number, gems: number): number {
    const fraction = gems / MAX_GEMS_PER_TRADE
    const impact = TRADE_IMPACT_MAX * fraction
    return clampPrice(price * (1 - impact))
}