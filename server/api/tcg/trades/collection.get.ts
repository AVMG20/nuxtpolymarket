import { requireUserId } from '#server/utils/auth'
import { tradeableCopiesOf } from '#server/utils/tcg/trade'

/**
 * A counterpart's tradeable copies (§7.1 — no anonymity). Printings,
 * serials and public grades only; condition never leaves the server.
 * `search` narrows by card name or collector number.
 */
export default defineEventHandler(async (event) => {
    await requireUserId(event)
    const q = getQuery(event)
    const ownerId = typeof q.userId === 'string' ? q.userId : ''
    const setId = typeof q.setId === 'string' ? q.setId : ''
    const search = typeof q.search === 'string' ? q.search.slice(0, 100) : ''
    if (!ownerId || !setId) {
        throw createError({ statusCode: 400, statusMessage: 'userId and setId are required' })
    }
    return await tradeableCopiesOf(ownerId, setId, search)
})
