import { requireUserId } from '#server/utils/auth'
import { listDisplays } from '#server/utils/tcg/display'

/** A player's binders and shelves — anyone logged in may look (§10.5). */
export default defineEventHandler(async (event) => {
    const callerId = await requireUserId(event)
    const q = getQuery(event)
    const ownerId = typeof q.userId === 'string' && q.userId ? q.userId : callerId
    return await listDisplays(ownerId)
})
