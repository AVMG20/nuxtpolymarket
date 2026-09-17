import { requireUserId } from '#server/utils/auth'
import { getTownResearchBoard } from '#server/utils/town-research'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return getTownResearchBoard(userId)
})
