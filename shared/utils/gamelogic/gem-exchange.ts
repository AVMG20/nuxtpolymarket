// ─── Gem Exchange — OSRS-style order book ────────────────────────────────────
// Players trade gems with each other through limit orders. There is no house
// market maker: every gem bought comes from another player's sell offer.

// ─── Limits ──────────────────────────────────────────────────────────────────
// There are deliberately no gameplay caps on price or quantity — the only
// bounds are what the database columns can physically hold.
export const GEM_EXCHANGE_MIN_PRICE = 0.01
/** int4 column limit — not a gameplay cap. */
export const GEM_EXCHANGE_MAX_QUANTITY = 2_147_483_647
/** Open offers per player. Enforced server-side, not surfaced in the UI. */
export const GEM_EXCHANGE_MAX_OPEN_ORDERS = 100

// ─── Guide price ──────────────────────────────────────────────────────────────
// Volume-weighted average of the last N trades; before any trade exists the
// exchange anchors on this value. A count-based window (rather than a time
// window like 24h) keeps the price meaningful with a small, sporadically
// trading player base — a slow day no longer starves it back to the fallback.
export const GEM_GUIDE_PRICE_FALLBACK = 300
export const GEM_GUIDE_PRICE_SAMPLE_SIZE = 30

/** Quick price nudges offered by the UI, as fractions of the guide price. */
export const GEM_PRICE_NUDGES = [0.05, 0.20] as const

// ─── History ──────────────────────────────────────────────────────────────────
export const GEM_EXCHANGE_HISTORY_DAYS = 30
export const GEM_EXCHANGE_HISTORY_LIMIT = 500
export const GEM_EXCHANGE_ORDER_LIST_LIMIT = 50

// ─── Money math ───────────────────────────────────────────────────────────────
// Prices are whole cents (two decimals). Totals are computed in integer cents,
// which stays exact as long as they fit in float64's safe-integer range — the
// validators below guarantee that, so escrow, refunds and payouts always
// balance to the cent.

export function gemPriceCents(price: number): number {
    return Math.round(price * 100)
}

export function isValidGemPrice(price: number): boolean {
    if (!Number.isFinite(price)) return false
    if (price < GEM_EXCHANGE_MIN_PRICE) return false
    if (price * 100 > Number.MAX_SAFE_INTEGER) return false
    return Math.abs(price * 100 - gemPriceCents(price)) < 1e-6
}

export function isValidGemQuantity(quantity: number): boolean {
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= GEM_EXCHANGE_MAX_QUANTITY
}

/** The order's escrow total must stay cent-exact and fit numeric(19,4). */
export function isValidGemOrderTotal(price: number, quantity: number): boolean {
    const totalCents = gemPriceCents(price) * quantity
    return totalCents <= Number.MAX_SAFE_INTEGER
}

/** Exact coin total for `quantity` gems at `price` coins each. */
export function gemOrderTotal(price: number, quantity: number): number {
    return gemPriceCents(price) * quantity / 100
}

// ─── Matching engine ──────────────────────────────────────────────────────────

export interface RestingGemOrder {
    id: string
    userId: string
    price: number
    remaining: number
}

export interface GemOrderFill {
    orderId: string
    userId: string
    price: number
    quantity: number
}

/**
 * Match an incoming limit order against the resting book.
 *
 * `book` must be the opposing side sorted best-first (asks: cheapest first,
 * bids: highest first; ties broken oldest first). Fills execute at the RESTING
 * order's price — offer more than a seller asks and you pay their (lower) ask,
 * exactly like the Grand Exchange giving change back. Matching your own
 * resting order is allowed and settles like any other fill, which keeps a
 * forgotten own offer from silently blocking a trade.
 */
export function matchGemOrder(opts: {
    side: 'buy' | 'sell'
    price: number
    quantity: number
    book: RestingGemOrder[]
}): { fills: GemOrderFill[], remaining: number } {
    const fills: GemOrderFill[] = []
    let remaining = opts.quantity

    for (const resting of opts.book) {
        if (remaining <= 0) break
        const crosses = opts.side === 'buy'
            ? resting.price <= opts.price
            : resting.price >= opts.price
        if (!crosses) break
        if (resting.remaining <= 0) continue

        const quantity = Math.min(remaining, resting.remaining)
        fills.push({ orderId: resting.id, userId: resting.userId, price: resting.price, quantity })
        remaining -= quantity
    }

    return { fills, remaining }
}
