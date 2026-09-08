import { requireUserId } from '#server/utils/auth'
import { startTownResearch } from '#server/utils/town-research'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return startTownResearch(userId, String(body?.researchId ?? ''))
})
