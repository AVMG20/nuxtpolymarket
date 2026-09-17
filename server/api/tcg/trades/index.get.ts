import { requireUserId } from '#server/utils/auth'
import { offersFor } from '#server/utils/tcg/trade'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return await offersFor(userId)
})
