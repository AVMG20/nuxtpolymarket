import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgPrinting } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { fetchCardPrice } from '#server/utils/tcg/prices'
import type { TcgRealPrice } from '#shared/types/tcg'

/**
 * What this printing costs in the real world. A fact about the card, not
 * about anyone's copy, so any signed-in player may read it for any printing —
 * unlike condition (§6.1), there is nothing here to leak.
 *
 * `price: null` covers both an unpriced card and an unreachable sidecar; the
 * caller shows nothing either way.
 */
export default defineEventHandler(async (event): Promise<{ price: TcgRealPrice | null }> => {
    await requireUserId(event)
    const printingId = getQuery(event).printingId
    if (typeof printingId !== 'string' || !printingId) {
        throw createError({ statusCode: 400, statusMessage: 'printingId is required' })
    }

    const [printing] = await db.select({ plaatjesCardId: tcgPrinting.plaatjesCardId })
        .from(tcgPrinting)
        .where(eq(tcgPrinting.id, printingId))
    if (!printing) throw createError({ statusCode: 404, statusMessage: 'No such printing' })

    const config = useRuntimeConfig(event)
    return { price: await fetchCardPrice(printing.plaatjesCardId, config.pokemonApiBase) }
})
