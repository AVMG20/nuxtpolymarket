import { SIDECAR_TIMEOUT_MS, sidecarFetch } from '#server/utils/tcg/sidecar'
import type { TcgRealPrice } from '#shared/types/tcg'

/*
 * Real-world card prices from the sidecar. Read-only context: shown while
 * inspecting a card, and the anchor the vendor buyback prices against (§7.4).
 */

/** The sidecar's `/cards/:id/price` shape — every field is optional. */
interface SidecarPriceResponse {
    price: {
        usd?: number | null
        eur?: number | null
        cardmarketUpdated?: string | null
        tcgplayerUpdated?: string | null
    } | null
}

/**
 * This printing's real-world price, or null.
 *
 * A read, so it degrades rather than throws: an unreachable sidecar and a
 * card nobody has priced both come back null, and callers show nothing.
 * Neither is an error worth putting in front of a player.
 */
export async function fetchCardPrice(plaatjesCardId: string, apiBase: string): Promise<TcgRealPrice | null> {
    let res: SidecarPriceResponse
    try {
        res = await sidecarFetch<SidecarPriceResponse>(
            `${apiBase}/cards/${encodeURIComponent(plaatjesCardId)}/price`,
            { timeout: SIDECAR_TIMEOUT_MS }
        )
    } catch {
        return null
    }
    const price = res?.price
    if (!price || (price.usd == null && price.eur == null)) return null
    return {
        usd: price.usd ?? null,
        eur: price.eur ?? null,
        // The two sources refresh independently; report the fresher one.
        updatedAt: [price.tcgplayerUpdated, price.cardmarketUpdated]
            .filter((at): at is string => typeof at === 'string' && at !== '')
            .sort()
            .pop() ?? null
    }
}
