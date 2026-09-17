import { requireUserId } from '#server/utils/auth'
import { getProductionHistory } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const hours = Number(getQuery(event).hours ?? 24)
    return getProductionHistory(userId, Number.isFinite(hours) ? hours : 24)
})
