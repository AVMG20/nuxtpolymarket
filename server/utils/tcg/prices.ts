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

/*
 * Prices are a fact about a card, identical for every player, and the sidecar
 * refreshes them about once a day — so they cache in process. Sorting a
 * collection by value asks for one price per owned card, which without a
 * cache is a fresh burst of sidecar requests every time the sort is picked.
 *
 * A MISS caches too, but briefly: a price that came back null because the
 * sidecar was down must not hold the vendor at its 1-coin floor for the next
 * quarter of an hour.
 */
const HIT_TTL_MS = 15 * 60_000
const MISS_TTL_MS = 60_000
const cache = new Map<string, { at: number, price: TcgRealPrice | null }>()

/** How many prices to have in flight at once during a bulk lookup. */
const BULK_CONCURRENCY = 8

function cached(plaatjesCardId: string): { price: TcgRealPrice | null } | null {
    const hit = cache.get(plaatjesCardId)
    if (!hit) return null
    const ttl = hit.price ? HIT_TTL_MS : MISS_TTL_MS
    if (Date.now() - hit.at > ttl) {
        cache.delete(plaatjesCardId)
        return null
    }
    return hit
}

/** Testing seam — drops everything so a spec can control what the cache holds. */
export function clearPriceCache(): void {
    cache.clear()
}

/**
 * This printing's real-world price, or null.
 *
 * A read, so it degrades rather than throws: an unreachable sidecar and a
 * card nobody has priced both come back null, and callers show nothing.
 * Neither is an error worth putting in front of a player.
 */
export async function fetchCardPrice(plaatjesCardId: string, apiBase: string): Promise<TcgRealPrice | null> {
    const hit = cached(plaatjesCardId)
    if (hit) return hit.price
    let res: SidecarPriceResponse
    try {
        res = await sidecarFetch<SidecarPriceResponse>(
            `${apiBase}/cards/${encodeURIComponent(plaatjesCardId)}/price`,
            { timeout: SIDECAR_TIMEOUT_MS }
        )
    } catch {
        cache.set(plaatjesCardId, { at: Date.now(), price: null })
        return null
    }
    const price = res?.price
    if (!price || (price.usd == null && price.eur == null)) {
        cache.set(plaatjesCardId, { at: Date.now(), price: null })
        return null
    }
    const resolved: TcgRealPrice = {
        usd: price.usd ?? null,
        eur: price.eur ?? null,
        // The two sources refresh independently; report the fresher one.
        updatedAt: [price.tcgplayerUpdated, price.cardmarketUpdated]
            .filter((at): at is string => typeof at === 'string' && at !== '')
            .sort()
            .pop() ?? null
    }
    cache.set(plaatjesCardId, { at: Date.now(), price: resolved })
    return resolved
}

/**
 * Prices for many cards at once, as a map keyed by the id passed in.
 *
 * The sidecar has no bulk price route, so this is one request per uncached
 * card, `BULK_CONCURRENCY` at a time — enough to keep a few hundred cards
 * quick without opening a connection per card. Every failure is already a
 * null from fetchCardPrice, so the whole call degrades card by card rather
 * than losing the batch.
 */
export async function fetchCardPrices(
    plaatjesCardIds: string[],
    apiBase: string
): Promise<Map<string, TcgRealPrice | null>> {
    const unique = [...new Set(plaatjesCardIds)]
    const out = new Map<string, TcgRealPrice | null>()
    let next = 0
    const worker = async (): Promise<void> => {
        while (next < unique.length) {
            const id = unique[next++]!
            out.set(id, await fetchCardPrice(id, apiBase))
        }
    }
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, unique.length) }, worker))
    return out
}
