import { requireUserId } from '#server/utils/auth'
import { voidBuyTrade } from '#server/utils/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return voidBuyTrade(userId)
})
