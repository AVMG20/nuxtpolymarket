// ─── Base price ───────────────────────────────────────────────────────────────
export const GEM_INITIAL_PRICE = 400          // $ per gem on first launch

// ─── Time-based growth ────────────────────────────────────────────────────────
export const GEM_HOURLY_GROWTH_RATE = 0.01    // base +1% per hour

// ─── Trade impact (linear, symmetric) ────────────────────────────────────────
// Full 50-gem trade moves the price by ±TRADE_IMPACT_MAX.
// Symmetric → buy(sell(p,n),n) < p always. Round-trip loss = x² per cycle.
export const GEM_TRADE_IMPACT_MAX = 0.10      // ±10% for a max-size trade

// ─── Mean-reversion (growth only, never trade impact) ─────────────────────────
export const GEM_REVERSION_CAP = 2.5          // floor/ceiling on growth multiplier

// ─── Hard limits ──────────────────────────────────────────────────────────────
export const GEM_MAX_PRICE = 1_000_000
export const GEM_MIN_PRICE = 0.01
export const GEM_MAX_GEMS_PER_TRADE = 50

// ─── History ──────────────────────────────────────────────────────────────────
export const GEM_HISTORY_DAYS = 30
export const GEM_HISTORY_LIMIT = 200

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
  const mult = Math.sqrt(GEM_INITIAL_PRICE / currentPrice)
  const capped = Math.min(Math.max(mult, 1 / GEM_REVERSION_CAP), GEM_REVERSION_CAP)
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

/** Price after buying N gems (price goes up). */
export function gemApplyBuyImpact(price: number, gems: number): number {
  const impact = GEM_TRADE_IMPACT_MAX * (gems / GEM_MAX_GEMS_PER_TRADE)
  return clampGemPrice(price * (1 + impact))
}

/** Price after selling N gems (price goes down). */
export function gemApplySellImpact(price: number, gems: number): number {
  const impact = GEM_TRADE_IMPACT_MAX * (gems / GEM_MAX_GEMS_PER_TRADE)
  return clampGemPrice(price * (1 - impact))
}
