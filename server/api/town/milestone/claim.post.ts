import { requireUserId } from '#server/utils/auth'
import { claimMilestone } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return claimMilestone(userId, String(body?.id ?? ''))
})
