import { requireUserId } from '#server/utils/auth'
import { salesHistory } from '#server/utils/tcg/market'
import type { TcgSaleRow } from '#shared/types/tcg'

/** Sold listings for one printing, newest first — the honest raw list (§7.2). */
export default defineEventHandler(async (event): Promise<TcgSaleRow[]> => {
    await requireUserId(event)
    const printingId = getQuery(event).printingId
    if (typeof printingId !== 'string' || !printingId) {
        throw createError({ statusCode: 400, statusMessage: 'printingId is required' })
    }
    return await salesHistory(printingId)
})
