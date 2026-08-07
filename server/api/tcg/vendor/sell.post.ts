import { requireUserId } from '#server/utils/auth'
import { copyForVendor, fetchVendorQuote, vendorCopy } from '#server/utils/tcg/vendor'

/**
 * Sell a raw copy to the vendor (§7.4): the copy is destroyed, the payout is
 * the card's real-world dollar price in Coins. Priced server-side from the
 * printing — nothing about money is trusted from the client.
 */
export default defineEventHandler(async (event): Promise<{ amount: number }> => {
    const userId = await requireUserId(event)
    const body = await readBody<{ copyId?: string }>(event)
    const copyId = body?.copyId
    if (typeof copyId !== 'string' || !copyId) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid copyId' })
    }

    const row = await copyForVendor(copyId)
    if (!row || row.copy.ownerId !== userId) {
        throw createError({ statusCode: 404, statusMessage: 'No such copy' })
    }

    // Quoted before the transaction so the copy row lock never spans HTTP;
    // vendorCopy's raw→destroyed claim is what makes the sell pay only once.
    const config = useRuntimeConfig()
    const amount = await fetchVendorQuote(row.plaatjesCardId, config.pokemonApiBase)
    return await vendorCopy(userId, copyId, amount)
})
