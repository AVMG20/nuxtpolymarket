import { requireUserId } from '#server/utils/auth'
import { ownershipChain } from '#server/utils/tcg/market'
import type { TcgChainEntry } from '#shared/types/tcg'

/** The copy's ownership chain (§11.3) — public to any signed-in player. */
export default defineEventHandler(async (event): Promise<TcgChainEntry[]> => {
    await requireUserId(event)
    const copyId = getQuery(event).copyId
    if (typeof copyId !== 'string' || !copyId) {
        throw createError({ statusCode: 400, statusMessage: 'copyId is required' })
    }
    return await ownershipChain(copyId)
})
