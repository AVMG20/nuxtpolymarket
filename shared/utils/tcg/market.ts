/**
 * Marketplace economics (§7.6): the fee is 5% of every sale, burned — never
 * pooled, never rebated, and NEVER routed through accumulateRake. It is the
 * module's primary permanent sink and the cost of faking a price history.
 */
export const TCG_MARKET = {
    feeRate: 0.05,
    minPrice: 1,
    maxPrice: 100_000_000,
    noteMaxLength: 280
} as const

/** What the seller actually receives after the burn. */
export function sellerProceeds(price: number): number {
    return Math.round(price * (1 - TCG_MARKET.feeRate) * 100) / 100
}
