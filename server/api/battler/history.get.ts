import { requireUserId } from '#server/utils/auth'
import { runHistory } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return await runHistory(userId)
})
