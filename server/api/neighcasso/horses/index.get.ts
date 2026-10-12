import { requireUserId } from '#server/utils/auth'
import { listHorses } from '#server/utils/neighcasso'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return listHorses(userId)
})
