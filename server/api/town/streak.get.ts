import { requireUserId } from '#server/utils/auth'
import { getTownStreak } from '#server/utils/town-streak'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return getTownStreak(userId)
})
