import { requireUserId } from '#server/utils/auth'
import { claimTownStreakStep } from '#server/utils/town-streak'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ step?: unknown }>(event)
    return claimTownStreakStep(userId, body?.step)
})
