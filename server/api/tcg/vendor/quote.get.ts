import { requireUserId } from '#server/utils/auth'
import { copyForVendor, fetchVendorQuote } from '#server/utils/tcg/vendor'

/**
 * What the vendor would pay for this copy — the card's real-world price, in
 * Coins (§7.4). Display only: the sell endpoint re-prices authoritatively.
 */
export default defineEventHandler(async (event): Promise<{ amount: number }> => {
    const userId = await requireUserId(event)
    const copyId = getQuery(event).copyId
    if (typeof copyId !== 'string' || !copyId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid copyId' })
    }

    const row = await copyForVendor(copyId)
    if (!row || row.copy.ownerId !== userId) {
        throw createError({ statusCode: 404, statusMessage: 'No such copy' })
    }
    if (row.copy.lifecycle !== 'raw') {
        throw createError({ statusCode: 400, statusMessage: 'The vendor only buys raw cards' })
    }

    const config = useRuntimeConfig()
    const amount = await fetchVendorQuote(row.plaatjesCardId, config.pokemonApiBase)
    return { amount }
})
