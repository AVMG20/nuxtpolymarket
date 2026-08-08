import { SERVICES } from './grading-model'
import type { TcgServiceKey } from './grading-model-types'

/**
 * Marketplace economics (§7.6): the fee is 5% of every sale, burned — never
 * pooled, never rebated, and NEVER routed through accumulateRake. It is the
 * module's primary permanent sink and the cost of faking a price history.
 */
export const TCG_MARKET = {
    feeRate: 0.05,
    minPrice: 1,
    maxPrice: 100_000_000,
    noteMaxLength: 280,
    /**
     * Copies whose numeric serial is at or below this are excluded from the
     * order book even when slabbed (§7.1): low serials are independently
     * desirable, so blind-filling a bid with one would either cheat the
     * seller or corrupt the book's fungibility. They sell as listings or
     * auctions, where the buyer can see what they are getting.
     */
    lowSerialMax: 10,
    /** Book limits: quantity per order and open orders per user. */
    maxOrderQuantity: 100,
    maxOpenOrders: 50,
    /** Bulk lot size bounds (§7.1): a lot is bulk, not a single. */
    lotMinCopies: 4,
    lotMaxCopies: 500,
    /** Trade offer bounds. */
    tradeMaxItemsPerSide: 20,
    tradeMaxOpenOffers: 20,
    /** Auction durations offered, ms. */
    auctionDurationsMs: [3_600_000, 21_600_000, 86_400_000]
} as const

// ── Book identity pickers ───────────────────────────────────────────────────
// A buy order may target any (printing, service, grade, designation) — even
// one no copy has earned yet. A standing bid on a nonexistent slab is the
// bounty that sends other players digging for the card.

/** Every grade this service can put on a slab, best first. */
export function bookGradeOptions(service: TcgServiceKey): string[] {
    const halfAtTop = (SERVICES[service] as { halfGradeAtTop?: boolean }).halfGradeAtTop
        || (SERVICES[service] as { fineScore?: boolean }).fineScore
    const grades: string[] = ['10']
    for (let g = 9.5; g >= 1; g -= 0.5) {
        if (g === 9.5 && !halfAtTop) continue
        grades.push(String(g))
    }
    return grades
}

/** Designations this service stamps on a grade — only ever at 10. */
export function bookDesignationOptions(service: TcgServiceKey, grade: string): string[] {
    if (grade !== '10') return []
    const d = (SERVICES[service] as { designation: { label: string, base: string } | null }).designation
    return d ? [d.label, d.base] : []
}

/** What the seller actually receives after the burn. */
export function sellerProceeds(price: number): number {
    return Math.round(price * (1 - TCG_MARKET.feeRate) * 100) / 100
}

/**
 * The minimum acceptable next bid: 5% over the standing bid (rounded up),
 * at least +1, and never below the start price.
 */
export function minNextBid(startPrice: number, currentBid: number | null): number {
    if (currentBid === null) return startPrice
    return Math.max(Math.ceil(currentBid * 1.05), currentBid + 1)
}
