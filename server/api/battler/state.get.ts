import { requireUserId } from '#server/utils/auth'
import { runView } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return await runView(userId)
})
