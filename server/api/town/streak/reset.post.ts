import { requireUserId } from '#server/utils/auth'
import { resetTownStreak } from '#server/utils/town-streak'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return resetTownStreak(userId)
})
