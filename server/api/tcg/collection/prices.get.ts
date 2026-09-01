import { and, eq, ne } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgCopy, tcgPrinting, tcgSet } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { fetchCardPrices } from '#server/utils/tcg/prices'
import type { TcgRealPrice } from '#shared/types/tcg'

/**
 * Real-world prices for every printing the caller owns — what the collection
 * gallery needs to sort by value.
 *
 * Fetched only when the player picks that sort, never as part of the gallery
 * itself: it is one sidecar request per distinct card the first time round
 * (they cache for 15 minutes afterwards), which is far too much to put in
 * front of every collection page load.
 *
 * Prices are public facts about cards (see price.get.ts), so the only private
 * thing here is WHICH cards are asked for — hence the caller's own collection.
 * An unpriced card and an unreachable sidecar are both null; the page leaves
 * those tiles at the end of the order either way.
 */
export default defineEventHandler(async (event): Promise<{ prices: Record<string, TcgRealPrice | null> }> => {
    const userId = await requireUserId(event)

    const owned = await db.selectDistinct({
        printingId: tcgCopy.printingId,
        plaatjesCardId: tcgPrinting.plaatjesCardId
    })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgSet, eq(tcgCopy.setId, tcgSet.id))
        .where(and(
            eq(tcgCopy.ownerId, userId),
            ne(tcgCopy.lifecycle, 'destroyed'),
            eq(tcgSet.status, 'committed')
        ))
    if (owned.length === 0) return { prices: {} }

    const config = useRuntimeConfig(event)
    const byCardId = await fetchCardPrices(owned.map(row => row.plaatjesCardId), config.pokemonApiBase)

    const prices: Record<string, TcgRealPrice | null> = {}
    for (const row of owned) {
        prices[row.printingId] = byCardId.get(row.plaatjesCardId) ?? null
    }
    return { prices }
})
